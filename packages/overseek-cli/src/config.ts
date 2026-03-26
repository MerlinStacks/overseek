import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

export interface CliConfig {
  url: string;
  token: string;
  accountId: string;
}

const CONFIG_DIR = path.join(os.homedir(), '.overseek');
const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json');

export function loadConfig(): CliConfig | null {
  // Environment variables take priority
  if (process.env.OVERSEEK_URL && process.env.OVERSEEK_TOKEN && process.env.OVERSEEK_ACCOUNT_ID) {
    return {
      url: process.env.OVERSEEK_URL,
      token: process.env.OVERSEEK_TOKEN,
      accountId: process.env.OVERSEEK_ACCOUNT_ID,
    };
  }

  // Fall back to config file
  if (fs.existsSync(CONFIG_FILE)) {
    const raw = fs.readFileSync(CONFIG_FILE, 'utf-8');
    return JSON.parse(raw) as CliConfig;
  }

  return null;
}

export function saveConfig(config: CliConfig): void {
  if (!fs.existsSync(CONFIG_DIR)) {
    fs.mkdirSync(CONFIG_DIR, { recursive: true });
  }
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
}

export function requireConfig(): CliConfig {
  const config = loadConfig();
  if (!config) {
    console.error(
      'Not configured. Run `overseek configure` or set OVERSEEK_URL, OVERSEEK_TOKEN, OVERSEEK_ACCOUNT_ID env vars.'
    );
    process.exit(1);
  }
  return config;
}
