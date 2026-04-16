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

    polygon: {
      chainId: 137,
      url: process.env.POLYGON_RPC_URL || "https://polygon-rpc.com",
      accounts: ACCOUNTS,
    },

    amoy: {
      chainId: 80002,
      url: process.env.AMOY_RPC_URL || "https://rpc-amoy.polygon.technology",
      accounts: ACCOUNTS,
    },

    base: {
      chainId: 8453,
      url: process.env.BASE_RPC_URL || "https://mainnet.base.org",
      accounts: ACCOUNTS,
    },

    baseSepolia: {
      chainId: 84532,
      url: process.env.BASE_SEPOLIA_RPC_URL || "https://sepolia.base.org",
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
        network: "polygon",
        chainId: 137,
        urls: {
          apiURL: "https://api.etherscan.io/v2/api?chainid=137",
          browserURL: "https://polygonscan.com",
        },
      },
      {
        network: "amoy",
        chainId: 80002,
        urls: {
          apiURL: "https://api.etherscan.io/v2/api?chainid=80002",
          browserURL: "https://amoy.polygonscan.com",
        },
      },
      {
        network: "base",
        chainId: 8453,
        urls: {
          apiURL: "https://api.etherscan.io/v2/api?chainid=8453",
          browserURL: "https://basescan.org",
        },
      },
      {
        network: "baseSepolia",
        chainId: 84532,
        urls: {
          apiURL: "https://api.etherscan.io/v2/api?chainid=84532",
          browserURL: "https://sepolia.basescan.org",
        },
      },
    ],
  },
};

export default config;
