// Only used by process-group integration tests; no external work.
if(process.env.CHILD_MODE==='crash')process.exit(7);
if(!['silent','stubborn'].includes(process.env.CHILD_MODE))process.send({type:'ready'});
process.on('message',message=>{if(message.type==='shutdown'&&process.env.CHILD_MODE!=='stubborn')process.exit(0);});
