const vscode = require('vscode');
exports.activate = context => { require('../vscode-ssh-test-runner.cjs').run(vscode, context).catch(error => console.error('ssh_fixture_failed', error.message)); };
exports.deactivate = () => {};
