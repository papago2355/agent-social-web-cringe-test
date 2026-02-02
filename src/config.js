import fs from 'fs';
import yaml from 'js-yaml';
import path from 'path';

const DEFAULT_CONFIG_PATH = './config.yaml';

let cachedConfig = null;

export function loadConfig(configPath = DEFAULT_CONFIG_PATH) {
  if (cachedConfig) return cachedConfig;
  
  const absolutePath = path.resolve(configPath);
  
  if (!fs.existsSync(absolutePath)) {
    throw new Error(`Config file not found: ${absolutePath}`);
  }
  
  const content = fs.readFileSync(absolutePath, 'utf8');
  cachedConfig = yaml.load(content);
  
  return cachedConfig;
}

export function getConfig(key, defaultValue = null) {
  const config = loadConfig();
  const keys = key.split('.');
  
  let value = config;
  for (const k of keys) {
    if (value && typeof value === 'object' && k in value) {
      value = value[k];
    } else {
      return defaultValue;
    }
  }
  
  return value ?? defaultValue;
}

export function reloadConfig(configPath = DEFAULT_CONFIG_PATH) {
  cachedConfig = null;
  return loadConfig(configPath);
}
