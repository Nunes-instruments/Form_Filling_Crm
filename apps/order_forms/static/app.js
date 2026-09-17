(function(){
  function n(v){const x=parseFloat(v);return Number.isFinite(x)?x:0}
  function money(v){return '₹ '+v.toFixed(2)}
  function updateRowNums(tbody){tbody.querySelectorAll('tr').forEach((r,i)=>{const c=r.querySelector('.rownum');if(c)c.textContent=i+1})}
  function recalc(){
    let mt=0;
    document.querySelectorAll('#marketingRows tr').forEach(r=>{mt+=n(r.querySelector('.qty')?.value)*n(r.querySelector('.itemv')?.value)+n(r.querySelector('.addc')?.value)});
    mt+=n(document.querySelector('.serviceamount')?.value); const m=document.querySelector('#marketingTotal');if(m)m.textContent=money(mt);
    let pt=0;document.querySelectorAll('.payamt').forEach(x=>pt+=n(x.value)); const p=document.querySelector('#paymentTotal');if(p)p.textContent=money(pt);
    const pb=document.querySelector('#paymentBalance');if(pb)pb.textContent=money(mt-pt);
    let bill=0;document.querySelectorAll('#accountRows tr').forEach(r=>{const t=n(r.querySelector('.aiv')?.value)+n(r.querySelector('.apf')?.value)+n(r.querySelector('.atax')?.value); const c=r.querySelector('.rowtotal');if(c)c.textContent=t.toFixed(2);bill+=t});
    const ba=document.querySelector('#billAmount');if(ba)ba.textContent=money(bill);
    let sp=0;document.querySelectorAll('.spamt').forEach(x=>sp+=n(x.value)); const sb=document.querySelector('#supplierBalance');if(sb)sb.textContent=money(bill-sp);
    const pc=n(document.querySelector('.pcost')?.value),sc=n(document.querySelector('.scost')?.value),pr=sc-pc,pct=pc?pr/pc*100:0;
    const prEl=document.querySelector('#profit'),pctEl=document.querySelector('#profitPct');if(prEl)prEl.value=pr.toFixed(2);if(pctEl)pctEl.value=pct.toFixed(2)+'%';
  }
  const templates={
    marketing:`<tr><td class="rownum"></td><td><input name="item_name[]"></td><td><input name="model[]"></td><td><input class="num qty" type="number" step="any" name="qty[]"></td><td><input class="num itemv" type="number" step="any" name="item_value[]"></td><td><input class="num addc" type="number" step="any" name="add_charge[]"></td><td><button type="button" class="mini delrow">×</button></td></tr>`,
    payment:`<tr><td><input type="date" name="payment_date[]"></td><td><input name="bank_mode[]"></td><td><input class="num payamt" type="number" step="any" name="payment_amount[]"></td><td><button type="button" class="mini delrow">×</button></td></tr>`,
    supplier:`<tr><td class="rownum"></td><td><input name="supplier[]"></td><td><input name="supplier_model[]"></td><td><input type="number" step="any" name="net_value[]"></td><td><input name="supplier_terms[]"></td><td><input name="supplier_delivery[]"></td><td><button type="button" class="mini delrow">×</button></td></tr>`,
    accounts:`<tr><td class="rownum"></td><td><input name="particulars[]"></td><td><input class="num aiv" type="number" step="any" name="acc_item_value[]"></td><td><input class="num apf" type="number" step="any" name="pf_charges[]"></td><td><input class="num atax" type="number" step="any" name="tax[]"></td><td class="rowtotal">0.00</td><td><button type="button" class="mini delrow">×</button></td></tr>`,
    supplierPayment:`<tr><td class="rownum"></td><td><input type="date" name="sp_date[]"></td><td><input name="bank_branch[]"></td><td><input name="sp_mode[]"></td><td><input class="num spamt" type="number" step="any" name="sp_amount[]"></td><td><button type="button" class="mini delrow">×</button></td></tr>`
  };
  document.addEventListener('click',e=>{
    const add=e.target.closest('.addrow');if(add){const tb=document.getElementById(add.dataset.target);if(tb){tb.insertAdjacentHTML('beforeend',templates[add.dataset.template]);updateRowNums(tb);recalc()}return}
    const del=e.target.closest('.delrow');if(del){const tb=del.closest('tbody');if(tb && tb.children.length>1){del.closest('tr').remove();updateRowNums(tb);recalc()}return}
  });
  document.addEventListener('input',e=>{if(e.target.matches('.num'))recalc()});
  recalc();
})();
