"""Every new decimal answer shape in the existing learning shell."""
from browser_test import Browser,ARTIFACTS
from competition_fixture import install,field,enter
import json

def run():
 b=Browser(http_port=8777,debug_port=9237);b.profile=ARTIFACTS/'decimal-ui-profile'
 with b:
  install(b);b.navigate('/index.html?trainer=decimal');b.eval('localStorage.clear();sessionStorage.clear()');b.navigate('/index.html?trainer=decimal')
  def click(a,v=None):b.click('[data-action="'+a+'"]'+('' if v is None else '[data-value="'+str(v)+'"]'))
  click('mode','personal');enter(b)
  ids=b.eval('DecimalTrainer.types.map(t=>t.id)')
  for type_id in ids:
   b.eval('globalThis.p=DecimalTrainer.generate('+json.dumps(type_id)+',17,"challenge");DecimalTrainer.generateSet=()=>[p]')
   click('start');b.wait('#answer-form')
   p=b.eval('p');k=p['answerKind'];a=p['answer']
   if k in ['choice','symbol']:click('decimal-choice',p['choices'].index(a))
   elif k=='order':
    for v in a:click('decimal-choice',p['choices'].index(v))
   elif k in ['fraction','ratio','remainder']:
    field(b,'[name=first]',a['quotient'] if k=='remainder' else a['n'],'input');field(b,'[name=second]',a['remainder'] if k=='remainder' else a['d'],'input')
   else:field(b,'[name=value]',a,'input')
   for w,h in [(360,800),(768,1024),(1366,768),(1920,1080)]:
    b.viewport(w,h)
    if not b.eval('document.documentElement.scrollWidth<=innerWidth'): print(type_id,w,b.eval('[...document.querySelectorAll("#app *")].filter(e=>e.getBoundingClientRect().right>innerWidth).map(e=>[e.className,e.tagName,e.getBoundingClientRect().width]).slice(-12)'))
    assert b.eval('document.documentElement.scrollWidth<=innerWidth'),type_id+' overflow'
   b.click('[type=submit]');assert b.eval('document.querySelector(".feedback").textContent.includes("정답") || document.querySelector(".feedback").textContent.includes("값은 맞")'),type_id
   click('next');click('home');click('mode','personal')
  click('home');click('mode','classroom')
  for type_id in ids:
   b.eval('globalThis.p=DecimalTrainer.generate('+json.dumps(type_id)+',17,"challenge");DecimalTrainer.generateSet=()=>[p]')
   click('start');b.viewport(1920,1080)
   for a in ['hint','hint','hint','answer','solution']:
    click(a);assert b.eval('document.documentElement.scrollHeight<=innerHeight && document.documentElement.scrollWidth<=innerWidth'),type_id+' '+a
   click('settings')
  assert not b.console_errors,b.console_errors
 print('PASS 49 personal input types, 49 FHD classroom types, 4 personal viewport sizes')
if __name__=='__main__':run()
