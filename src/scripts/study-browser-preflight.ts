import {chromium,expect} from '@playwright/test';
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createStudyEnvironment} from './study-environment.js';

await mkdir('evaluation/study/browser',{recursive:true});
const checkedAt=new Date().toISOString(),rows=[];let status='PASS',error:string|undefined;
const browser=await chromium.launch({channel:process.env.PLAYWRIGHT_CHANNEL??'chrome',headless:true});
try{
  for(const id of ['U01','U09','U10']){
    const environment=await createStudyEnvironment(id),context=await browser.newContext({viewport:{width:1440,height:1000}});
    try{
      const page=await context.newPage(),errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
      await page.goto(environment.url);await page.getByLabel('Demo account').selectOption(environment.task.role==='OWNER'?'20000000-0000-4000-8000-000000000001':'20000000-0000-4000-8000-000000000002');
      await page.getByRole('button',{name:'Open workspace'}).click();
      await expect(page.getByRole('heading',{name:'Orders',exact:true})).toBeVisible();
      await page.goto(environment.url);
      await expect(page.getByRole('heading',{name:`STUDY-${id}-${environment.task.context}`,exact:true})).toBeVisible();
      await expect(page.getByTestId('receipt-amount')).toHaveText(id==='U09'?'RM 780.00':'RM 128.00');
      if(id==='U09'){
        await expect(page.getByText('This result is no longer current. Run the checks again.',{exact:true})).toBeVisible();
        await expect(page.getByRole('button',{name:'Approve & confirm payment',exact:true})).toHaveCount(0);
      }
      if(errors.length)throw Error('Unhandled study page error');
      await page.screenshot({path:resolve(`evaluation/study/browser/${id}.png`),fullPage:true});
      rows.push({id,status:'PASS',page_errors:errors});console.log(`${id}: browser PASS`);
    }finally{await context.close();await environment.close();}
  }
}catch(e){status='FAIL';error=e instanceof Error?e.message:'Study browser preflight failed';process.exitCode=1;console.error(error);}
finally{
  await browser.close();
  await writeFile('evaluation/study/browser/results.json',JSON.stringify({checked_at:checkedAt,status,error,rows,scope:'Three fixture-mode study pages on installed Chrome; automated technical preflight, not participant usability or all-ten-task browser rehearsal'},null,2)+'\n');
}
