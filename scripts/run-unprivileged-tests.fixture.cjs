const { spawn } = require('node:child_process');
const { test } = require('node:test');

test('signal fixture with live descendants', () =>
  new Promise(() => {
    const child = spawn(
      process.execPath,
      [
        '-e',
        `
    const {spawn}=require('node:child_process');
    const grandchild=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'});
    grandchild.once('spawn',()=>console.log(JSON.stringify({pids:[process.pid,grandchild.pid],root:process.env.WENYOU_TEST_ROOT})));
    setInterval(()=>{},1000);
  `,
      ],
      { stdio: ['ignore', 'pipe', 'inherit'] },
    );
    child.stdout.on('data', (chunk) =>
      console.log('WENYOU_ACTIVE_FIXTURE ' + chunk.toString().trim()),
    );
  }));
