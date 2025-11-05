const NodePolyfillPlugin = require('node-polyfill-webpack-plugin');
const { env, nodeless } = require('unenv');

const { alias: turbopackAlias } = env(nodeless, {});

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Turbopack
  experimental: {
    turbo: {
      resolveAlias: {
        ...turbopackAlias,
      },
    },
  },
  // Show all logs in dev for debugging
  logging: {
    level: 'verbose', // Change to 'error' later to reduce noise
  },
  // Webpack
  webpack: (config, { isServer }) => {
    if (!isServer) {
      config.plugins.push(new NodePolyfillPlugin());
    }
    return config;
  },
};

module.exports = nextConfig;
