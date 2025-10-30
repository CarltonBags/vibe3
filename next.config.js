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
  // Reduce noisy request logging in dev
  logging: {
    level: 'error',
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
