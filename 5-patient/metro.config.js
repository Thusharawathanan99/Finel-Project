const { getDefaultConfig } = require('expo/metro-config');
const { FileStore } = require('metro-cache');
const path = require('path');

const config = getDefaultConfig(__dirname);
// Keep the face-report contract shared with the website and server in Metro's file map.
config.watchFolders = [...new Set([...config.watchFolders, path.resolve(__dirname, '../shared')])];
config.cacheStores = [
  new FileStore({ root: path.join(__dirname, '.metro-cache') }),
];

module.exports = config;
