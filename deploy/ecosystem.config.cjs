module.exports = {
  apps: [{
    name: 'leglegweb',
    script: 'server/index.js',
    cwd: '/var/www/leglegweb',
    env: {
      NODE_ENV: 'production',
      PORT: 3000
    }
  }]
};
