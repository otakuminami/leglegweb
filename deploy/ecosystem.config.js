module.exports = {
  apps: [{
    name: 'leglegweb',
    script: 'server/index.js',
    cwd: '/var/www/leglegweb',
    node_args: '-r dotenv/config',
    env: {
      DOTENV_CONFIG_PATH: '/var/www/leglegweb/server/.env',
      NODE_ENV: 'production',
      PORT: 3000
    }
  }]
};
