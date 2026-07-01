import { Connection, Keypair } from "@solana/web3.js";
import bs58 from "bs58";
import { config } from "./config.js";

let _wallet = null;
let _txConnection = null;
let _pollConnection = null;

export function getWallet() {
  if (!_wallet) {
    if (!process.env.WALLET_PRIVATE_KEY) {
      throw new Error("WALLET_PRIVATE_KEY not set in .env");
    }
    _wallet = Keypair.fromSecretKey(bs58.decode(process.env.WALLET_PRIVATE_KEY));
  }
  return _wallet;
}

// Connection used to SEND transactions (claim, remove liquidity, close).
export function getTxConnection() {
  if (!_txConnection) {
    if (!config.rpc.txRpcUrl) {
      throw new Error("RPC_URL not set in .env (needed to send transactions)");
    }
    _txConnection = new Connection(config.rpc.txRpcUrl, "confirmed");
  }
  return _txConnection;
}

// Connection used to POLL position state. Deliberately separate from the
// tx connection so aggressive read polling never risks rate-limiting or
// costing money on the RPC used for real transactions.
export function getPollConnection() {
  if (!_pollConnection) {
    _pollConnection = new Connection(config.rpc.pollRpcUrl, "confirmed");
  }
  return _pollConnection;
}
