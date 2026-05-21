const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// Ensure web platform resolves correctly
config.resolver.resolverMainFields = ['react-native', 'browser', 'main'];

module.exports = config;
