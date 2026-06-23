// metro.config.js
// Metro configuration optimized for Expo, Expo Router, and NativeWind styling integrations.

const { getDefaultConfig } = require("expo/metro-config");

const config = getDefaultConfig(__dirname);

// Configure asset resolution or any special file extensions
config.resolver.sourceExts.push("mjs");

module.exports = config;
