module.exports = {
  apps: [{
    name: "arcflow-nanoclaw",
    script: "/data/project/nanoclaw/start.sh",
    interpreter: "bash",
    cwd: "/data/project/nanoclaw",
    time: true,
    autorestart: true,
  }]
};
