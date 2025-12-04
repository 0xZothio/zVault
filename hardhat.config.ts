import { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox";
import "hardhat-deploy";
import dotenv from 'dotenv'

dotenv.config()

const DEPLOYER_ACCOUNT_PRIV_KEY = process.env.DEPLOYER_ACCOUNT_PRIV_KEY
const ACCOUNTS = [DEPLOYER_ACCOUNT_PRIV_KEY].filter(Boolean) as string[]

const config: HardhatUserConfig = {
  solidity: {
    compilers: [
      {
        version: "0.8.9",
        settings: {
          optimizer: { enabled: true, runs: 200 },
        },
      },
      {
        version: "0.8.19",
        settings: {
          optimizer: { enabled: true, runs: 200 },
        },
      },
      {
        version: "0.8.20",
        settings: {
          optimizer: { enabled: true, runs: 200 },
        },
      },
    ],
  },

  networks: {
    hardhat: { allowUnlimitedContractSize: true },

    mainnet: {
      chainId: 137,
      url: "https://polygon-mainnet.g.alchemy.com/v2/2IKaKbipheAk3qec3VSgM",
      accounts: ACCOUNTS,
    },

    amoy: {
      chainId: 80002,
      url: "https://rpc-amoy.polygon.technology",
      accounts: ACCOUNTS,
    },

    virtual_mainnet: {
      url: "https://virtual.mainnet.rpc.tenderly.co/" + process.env.TENDERLY_KEY,
      chainId: 8888,
      accounts: ACCOUNTS,
    }
  },

  etherscan: {
    apiKey: process.env.POLYGONSCAN_API_KEY,
    customChains: [
      {
        network: "amoy",
        chainId: 80002,
        urls: {
          apiURL: "https://api.etherscan.io/v2/api?chainid=80002",
          browserURL: "https://amoy.polygonscan.com",
        },
      },
      {
        network: "polygon",
        chainId: 137,
        urls: {
          apiURL: "https://api.polygonscan.com/api",
          browserURL: "https://polygonscan.com",
        },
      },
    ],
  },
};

export default config;
