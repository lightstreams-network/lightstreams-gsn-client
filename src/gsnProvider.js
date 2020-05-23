import {
	RELAY_URL,
	RELAY_HUB,
	RELAY_ADRRESS,
	RELAY_FEE,
	GAS_PRICE,
	BLOCKCHAIN_RPC,
	CHAIN_ID,
	CHAIN_NAME
} from "react-native-dotenv";

import { Buffer } from 'buffer'

const inherits = require("inherits");
const ethers = require("ethers");
const relayHubAbi = require('./IRelayHub');

const network = {
	chainId: parseInt(CHAIN_ID),
	name: CHAIN_NAME
};

function GsnProvider(url, network) {
	ethers.providers.BaseProvider.call(this, network.chainId);
	this.subprovider = new ethers.providers.JsonRpcProvider(url, network.chainId);
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
	if (method === "sendTransaction") {
		let from = params.contract.signer.address;
		let to = params.contract.address;
		let tx = params.data;
		let txfee = parseInt(RELAY_FEE);
		let gas_price = GAS_PRICE;
		let gas_limit = params.gasLimit.toString();
		let relay_hub_address = RELAY_HUB;
		let relay_address = RELAY_ADRRESS;
		let privateKey = params.contract.signer.privateKey;

		let relayHub = new ethers.Contract(RELAY_HUB, relayHubAbi, this.subprovider);
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

		let relayRes;

		try {
			relayRes = await fetch(RELAY_URL + "/relay", {
				method: "POST",
				headers: {
					"Content-Type": "application/json"
				},
				body: JSON.stringify(jsonRequestData)
			});
			data = await relayRes.json()
			if (data.error) {
				console.log("error from relay:", data.error);
			}
		} catch (err) {
			console.log("error from post request to relay", err);
		}
		return new Promise(function (resolve, reject) {
			resolve(relayRes);
		});
	}

	if (method === "sendSignedTransaction") {
		return new Promise(function (resolve, reject) {
			resolve();
		});
	}

	return this.subprovider.perform(method, params).then(function (result) {
		return result;
	});
};

export const provider = (url) => {
	return new GsnProvider(url, network);
};
