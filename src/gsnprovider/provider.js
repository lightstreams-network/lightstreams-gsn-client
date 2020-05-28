const Buffer = require('buffer').Buffer;
const inherits = require("inherits");
const ethers = require("ethers");
const relayHubAbi = require('./IRelayHub');

function GsnProvider(config) {
    this.config = config;
    this.data = null;
    let chainId = parseInt(config.chainId);

	ethers.providers.BaseProvider.call(this, chainId);
	this.subprovider = new ethers.providers.JsonRpcProvider(config.blockchainRpc, chainId);
}
inherits(GsnProvider, ethers.providers.BaseProvider);

function bytesToHex_noPrefix(bytes) {
	let hex = removeHexPrefix(bytes);
	if (hex.length % 2 != 0) {
		hex = "0" + hex;
	}
	return hex;
}

function toUint256_noPrefix(int) {
	let hex = ethers.utils.hexlify(int);
	let padded = ethers.utils.hexZeroPad(hex, 32);
	return removeHexPrefix(padded);
}

function removeHexPrefix(hex) {
	return hex.replace(/^0x/, "");
}

function parseHexString(str) {
	var result = [];
	while (str.length >= 2) {
		result.push(parseInt(str.substring(0, 2), 16));

		str = str.substring(2, str.length);
	}

	return result;
}

function getTransactionHash(
	from,
	to,
	tx,
	txfee,
	gas_price,
	gas_limit,
	nonce,
	relay_hub_address,
	relay_address
) {
	let relay_prefix = "rlx:";
	let txhstr = bytesToHex_noPrefix(tx);
	let dataToHash =
		Buffer.from(relay_prefix).toString("hex") +
		removeHexPrefix(from) +
		removeHexPrefix(to) +
		txhstr +
		toUint256_noPrefix(parseInt(txfee)) +
		toUint256_noPrefix(parseInt(gas_price)) +
		toUint256_noPrefix(parseInt(gas_limit)) +
		toUint256_noPrefix(parseInt(nonce)) +
		removeHexPrefix(relay_hub_address) +
		removeHexPrefix(relay_address);

	let hash1 = ethers.utils.keccak256("0x" + dataToHash);
	let msg = Buffer.concat([
		Buffer.from("\x19Ethereum Signed Message:\n32"),
		Buffer.from(removeHexPrefix(hash1), "hex")
	]);
	let hash2 = ethers.utils.keccak256("0x" + msg.toString("hex"));
	return hash2;
}

GsnProvider.prototype.perform = async function (method, params) {
	
	if (method === "preSendTransaction") {
		let from = params.contract.signer.address;
		let to = params.contract.address;
		let tx = params.data;
		let txfee = parseInt(this.config.relayFee);
		let gas_price = this.config.gasPrice;
		let gas_limit = params.gasLimit.toString();
		let relay_hub_address = this.config.relayHub;
		let relay_address = this.config.relyAddress;
		let privateKey = params.contract.signer.privateKey;
        let relayUrl = this.config.relayUrl;

		let relayHub = new ethers.Contract(relay_hub_address, relayHubAbi, this.subprovider);
		let nonce = parseInt(await relayHub.getNonce(from));

		let hash = getTransactionHash(
			from,
			to,
			tx,
			txfee,
			gas_price,
			gas_limit,
			nonce,
			relay_hub_address,
			relay_address
		);
		let key = new ethers.utils.SigningKey(privateKey);

		let signed = ethers.utils.joinSignature(key.signDigest(hash));
		
		let relayMaxNonce =
			(await this.subprovider.getTransactionCount(relay_address)) + 3;

		let jsonRequestData = {
			encodedFunction: tx,
			signature: parseHexString(signed.replace(/^0x/, "")),
			approvalData: [],
			from: from,
			to: to,
			gasPrice: parseInt(gas_price),
			gasLimit: parseInt(gas_limit),
			relayFee: txfee,
			RecipientNonce: parseInt(nonce),
			RelayMaxNonce: relayMaxNonce,
			RelayHubAddress: relay_hub_address
		};

		let data;

		try {
			let relayRes = await fetch(relayUrl + "/relay", {
				method: "POST",
				headers: {
					"Content-Type": "application/json"
				},
				body: JSON.stringify(jsonRequestData)
			});
			data = await relayRes.json()
			if (data.error) {
				console.log("error received from relay:", data.error);
				return new Promise(function (resolve, reject) {
					reject(null, data.error);
				});
			}
		} catch (err) {
			console.log("error thrown from relay post:", err);
			return new Promise(function (resolve, reject) {
				reject(null, err);
			});
		}

		this.data = data;

		return new Promise(function (resolve, reject) {
			resolve(data.hash);
		});
	}

	if (method === "sendTransaction") {
		data = this.data
		return new Promise(function (resolve, reject) {
			resolve(data.hash);
		});
	}

	return this.subprovider.perform(method, params).then(function (result) {
		return result;
	});
};

module.exports.new = (config) => {
	return new GsnProvider(config);
};
