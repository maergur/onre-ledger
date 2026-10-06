(function(){
"use strict";
var D=JSON.parse(document.getElementById("payload").textContent);
var FULL=JSON.parse(document.getElementById("full").textContent);
var N=FULL.pts.length;

function addrAt(i){return FULL.addrs.substr(i*44,44).trim();}
function ptsAt(i){return FULL.pts[i];}
function rtsAt(i){return FULL.rts[i];}
function seenAt(i){return FULL.seen[i];}

/* ---------- formatting ---------- */
var nf=new Intl.NumberFormat("en-US");
function n(x){return nf.format(Math.round(x));}
function pct(x,d){return (x*100).toFixed(d===undefined?4:d)+"%";}
function short(a){return a.length>14?a.slice(0,6)+"…"+a.slice(-5):a;}
function esc(s){return String(s).replace(/[&<>"]/g,function(c){
  return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c];});}
function compact(x){
  var s=x<0?"-":""; x=Math.abs(x);
  if(x>=1e9)return s+(x/1e9).toFixed(2)+"B";
  if(x>=1e6)return s+(x/1e6).toFixed(2)+"M";
  if(x>=1e3)return s+(x/1e3).toFixed(1)+"K";
  return s+Math.round(x);
}
function rateWindow(){
  var d=Math.round(D.rateDays*10)/10;
  return d<=1
    ? "single day, "+D.rateFrom+" → "+D.rateTo
    : d+"-day average, "+D.rateFrom+" → "+D.rateTo;
}

/* ---------- hash routing (plain tokens only: w-<addr>, event-<date>, standings, about) ---------- */
function setHash(h){
  try{ history.replaceState(null,"",h?"#"+h:location.pathname+location.search); }catch(e){}
}

/* ---------- dialogs ---------- */
function openDlg(id,hash){
  var d=document.getElementById(id);
  if(!d.open){ try{d.showModal();}catch(e){d.setAttribute("open","");} }
  d.scrollTop=0;
  try{ d.focus({preventScroll:true}); }catch(e){}
  if(hash)setHash(hash);
  return d;
}
Array.prototype.forEach.call(document.querySelectorAll("dialog.pop"),function(d){
  d.addEventListener("click",function(e){
    if(e.target===d||e.target.closest("[data-close]"))d.close();
  });
  d.addEventListener("close",function(){
    var top=document.querySelector("dialog.pop[open]");
    setHash(top&&top.id==="dlg-standings"?"standings":"");
  });
});

/* ---------- emission series ---------- */
var S=D.series, daily=[];
for(var k=1;k<S.length;k++){
  var a=S[k-1], b=S[k];
  var d0=new Date(a[0]+"T00:00:00Z"), d1=new Date(b[0]+"T00:00:00Z");
  var gap=Math.max(1,Math.round((d1-d0)/864e5));
  /* Snapshots are captured at whatever hour the run happened, so when both carry a
     capture time, divide by real elapsed hours rather than by whole calendar days. */
  var hrs=null, exact=false;
  if(a[3]&&b[3]){
    var dh=(new Date(b[3])-new Date(a[3]))/36e5;
    if(isFinite(dh)&&dh>0){hrs=dh; exact=true;}
  }
  if(hrs===null)hrs=gap*24;
  daily.push({date:b[0], v:(b[1]-a[1])/(hrs/24), gap:gap, hrs:hrs, exact:exact});
}
var latest=daily[daily.length-1];

/* ---------- header + stat strip ---------- */
document.getElementById("asof").innerHTML='<span class="upd">Updated </span>'+esc(D.asOf)+(D.asOfTime?" "+esc(D.asOfTime)+'<span class="tz"> (UTC+3)</span>':"");
var spanDays=Math.round(D.rateDays*10)/10;
document.getElementById("stats").innerHTML=[
  ["Total points",compact(D.system),n(D.system),
   "Every point OnRe has credited to every wallet, summed from the "+D.asOf+" snapshot."],
  ["Wallets ranked",n(N),(N-S[S.length-2][2]>=0?"+":"")+n(N-S[S.length-2][2])+" since "+S[S.length-2][0],
   "Wallets holding at least one point. The change underneath counts wallets that appeared since the previous snapshot."],
  ["Net change / day",compact(latest.v),latest.v<0?"supply fell":"measured "+latest.date,
   "How much the total supply moved between the last two snapshots ("+(latest.exact?latest.hrs.toFixed(1)+" hours":latest.gap+" days")+
   "), scaled to 24 hours. It nets everything together: points earned, new wallets arriving with points, balances that went down and clawbacks. It can go negative."],
  ["Avg emission / day",compact(D.totalRate),spanDays+"-day average · "+n(D.movedCount)+" wallets earning",
   "Points credited to existing wallets per day, averaged over the last "+spanDays+" days ("+D.rateFrom+" → "+D.rateTo+
   "). Each wallet's gain is divided by the elapsed time and the results are added up. Wallets that went down count as zero and wallets that are new in the window are left out. Projections and the airdrop calculator use this figure."]
].map(function(r,ix){
  var cls = ix===2 ? (latest.v<0?"s dn":"s up") : "s";
  return '<div class="stat"><button type="button" class="k ktip" data-tip="'+esc(r[3])+'" aria-label="'+esc(r[0]+": "+r[3])+'">'+r[0]+
         '<span class="qi" aria-hidden="true">?</span></button><span class="v">'+r[1]+
         '</span><span class="'+cls+'">'+r[2]+'</span></div>';
}).join("");

/* ---------- tooltips: one floating box, shown on hover, focus or tap ---------- */
(function(){
  var tip=document.createElement("div"); tip.className="tip"; tip.setAttribute("role","tooltip"); tip.hidden=true;
  document.body.appendChild(tip);
  var cur=null, shownAt=0;
  function show(el){
    if(cur!==el||tip.hidden)shownAt=Date.now();
    cur=el; tip.textContent=el.dataset.tip; tip.hidden=false;
    var r=el.getBoundingClientRect(), tw=Math.min(320,innerWidth-32);
    tip.style.width=tw+"px";
    var left=Math.max(16,Math.min(r.left,innerWidth-tw-16));
    tip.style.left=left+"px";
    var th=tip.offsetHeight, top=r.bottom+8;
    if(top+th>innerHeight-8)top=Math.max(8,r.top-th-8);
    tip.style.top=top+"px";
  }
  function hide(){ cur=null; tip.hidden=true; }
  document.addEventListener("mouseover",function(e){ var el=e.target.closest(".ktip"); if(el)show(el); else if(cur&&!cur.contains(document.activeElement))hide(); });
  document.addEventListener("focusin",function(e){ var el=e.target.closest(".ktip"); if(el)show(el); });
  document.addEventListener("focusout",function(e){ if(e.target.closest(".ktip"))hide(); });
  /* a tap fires focus then click: only treat the click as "close" if the tip was already open */
  document.addEventListener("click",function(e){ var el=e.target.closest(".ktip");
    if(el){ if(cur===el&&!tip.hidden&&Date.now()-shownAt>400)hide(); else show(el); } else hide(); });
  document.addEventListener("keydown",function(e){ if(e.key==="Escape")hide(); });
  addEventListener("scroll",function(){ if(Date.now()-shownAt>400)hide(); },{passive:true});
  addEventListener("resize",function(){ if(cur&&!tip.hidden)show(cur); });
})();

/* ---------- emission chart ---------- */
(function(){
  var data=daily.slice(-30), W=620, H=290, PL=56, PR=10, PT=12, PB=30;
  var iw=W-PL-PR, ih=H-PT-PB;
  var vals=data.map(function(d){return d.v;});
  var hi=Math.max.apply(null,vals.concat([0])), lo=Math.min.apply(null,vals.concat([0]));
  /* round tick step (1/2/2.5/5 x 10^n) so every axis label is a clean value */
  var raw=(hi-lo)/4, mag=Math.pow(10,Math.floor(Math.log10(raw||1))), step=mag;
  [1,2,2.5,5,10].some(function(m){ step=m*mag; return m*mag>=raw; });
  hi=Math.ceil(hi/step)*step; lo=Math.floor(lo/step)*step;
  var ticks=[]; for(var tv=lo; tv<=hi+step/2; tv+=step) ticks.push(tv);
  function y(v){return PT+ih-((v-lo)/(hi-lo))*ih;}
  var bw=iw/data.length, gap=Math.min(4,bw*0.28), zero=y(0), out=[];
  for(var t=0;t<ticks.length;t++){
    var v=ticks[t], yy=y(v);
    out.push('<line x1="'+PL+'" y1="'+yy.toFixed(1)+'" x2="'+(W-PR)+'" y2="'+yy.toFixed(1)+
      '" stroke="var(--line)" stroke-width="1"/>');
    out.push('<text x="'+(PL-8)+'" y="'+(yy+3.5).toFixed(1)+'" text-anchor="end" fill="var(--faint)" '+
      'font-family="IBM Plex Mono, monospace" font-size="10">'+compact(v)+'</text>');
  }
  out.push('<line x1="'+PL+'" y1="'+zero.toFixed(1)+'" x2="'+(W-PR)+'" y2="'+zero.toFixed(1)+
    '" stroke="var(--line-2)" stroke-width="1.5"/>');
  data.forEach(function(d,ix){
    var x=PL+ix*bw+gap/2, w=Math.max(1,bw-gap);
    var yy=y(d.v), top=Math.min(yy,zero), h=Math.max(1.5,Math.abs(yy-zero));
    out.push('<rect x="'+x.toFixed(1)+'" y="'+top.toFixed(1)+'" width="'+w.toFixed(1)+
      '" height="'+h.toFixed(1)+'" fill="'+(d.v<0?"var(--bad)":"var(--bar)")+'" rx="1.5"><title>'+
      d.date+": "+compact(d.v)+"/day"+
      (d.exact?" (normalised over "+d.hrs.toFixed(1)+"h)":d.gap>1?" (averaged over "+d.gap+" days)":"")+'</title></rect>');
    if(ix%6===0||ix===data.length-1){
      out.push('<text x="'+(x+w/2).toFixed(1)+'" y="'+(H-11)+'" text-anchor="middle" fill="var(--faint)" '+
        'font-family="IBM Plex Mono, monospace" font-size="9.5">'+d.date.slice(5)+'</text>');
    }
  });
  document.getElementById("chart").innerHTML=
    '<svg viewBox="0 0 '+W+' '+H+'" role="img" aria-label="Net daily change in total points supply over the last 30 snapshots">'+
    out.join("")+'</svg>';
})();

/* ---------- events ---------- */
var EV=(D.events||[]).slice();
var asofD=new Date(D.asOf+"T00:00:00Z");
function rel(d){
  var g=Math.round((new Date(d+"T00:00:00Z")-asofD)/864e5);
  return g===0?"snapshot day":g<0?(-g)+(g===-1?" day ago":" days ago"):"in "+g+(g===1?" day":" days");
}
function chipsOf(e){
  return (e.impact||[]).map(function(c){
    return '<span class="chip"><b>'+esc(c[0])+'</b><span>'+esc(c[1])+'</span></span>';}).join("");
}
/* Events live behind the bell. "New" = later than what this browser has seen; on a first visit,
   only events from the last 7 days count as new. Seen state is per-browser (localStorage). */
var SEEN_KEY="onre-seen-events";
function seenDate(){
  try{ var v=localStorage.getItem(SEEN_KEY); if(v)return v; }catch(e){}
  var d=new Date(asofD.getTime()-7*864e5); return d.toISOString().slice(0,10);
}
function markSeen(){
  if(!EV.length)return;
  var latest=EV.reduce(function(m,e){return e.date>m?e.date:m;},"");
  try{ localStorage.setItem(SEEN_KEY,latest); }catch(e){}
  renderBell();
}
function isNew(e){ return e.kind!=="ahead" && e.date>seenDate(); }
function renderBell(){
  var unread=EV.filter(isNew), badge=document.getElementById("bellcount"), bell=document.getElementById("bell");
  badge.textContent=unread.length; badge.hidden=!unread.length;
  bell.setAttribute("aria-label", unread.length ? "What changed, "+unread.length+" new" : "What changed");
  var lst=document.getElementById("evlist");
  Array.prototype.forEach.call(lst.querySelectorAll("[data-ev]"),function(b){
    b.classList.toggle("unread", isNew(EV[+b.dataset.ev]));
  });
  var nb=document.getElementById("newsbar"), top=unread[0];
  if(top&&!nb.dataset.dismissed){
    nb.className="newsbar "+top.kind; nb.hidden=false;
    document.getElementById("ntitle").textContent=top.title;
    document.getElementById("nsum").textContent=top.summary;
    nb.dataset.ev=EV.indexOf(top);
  }else nb.hidden=true;
}
(function(){
  var el=document.getElementById("evlist");
  if(!EV.length){document.getElementById("events-sec").hidden=true; return;}
  el.innerHTML=EV.map(function(e,i){
    var c=chipsOf(e);
    return '<button type="button" class="ev '+esc(e.kind)+'" data-ev="'+i+'"><span class="stripe" aria-hidden="true"></span><span>'+
      '<span class="tl-when"><span class="tl-date">'+esc(e.date)+'</span><span class="tl-rel">'+rel(e.date)+'</span></span>'+
      '<span class="tl-title" style="display:block">'+esc(e.title)+'</span>'+
      '<span class="tl-sum" style="display:block">'+esc(e.summary)+'</span>'+
      (c?'<span class="tl-chips">'+c+'</span>':'')+
      (e.body?'<span class="more">Read the full event</span>':'')+
    '</span></button>';
  }).join("");
  var bell=document.getElementById("bell"), panel=document.getElementById("notif");
  function setOpen(o){
    panel.hidden=!o; bell.setAttribute("aria-expanded",o?"true":"false");
    /* on phones the panel is fixed full-width; start it just under the bell so the bell stays tappable */
    panel.style.top = (o&&matchMedia("(max-width:640px)").matches) ? (bell.getBoundingClientRect().bottom+10)+"px" : "";
  }
  bell.addEventListener("click",function(e){
    e.stopPropagation();
    var opening=panel.hidden; setOpen(opening);
    /* opening the list counts as reading it; badges clear when it closes so NEW tags stay visible while open */
    if(!opening)markSeen();
  });
  el.addEventListener("click",function(e){
    var b=e.target.closest("[data-ev]"); if(!b)return;
    setOpen(false); markSeen(); openEvent(+b.dataset.ev);
  });
  document.addEventListener("click",function(e){
    if(!panel.hidden&&!e.target.closest("#events-sec")){ setOpen(false); markSeen(); }
  });
  document.addEventListener("keydown",function(e){
    if(e.key==="Escape"&&!panel.hidden){ setOpen(false); markSeen(); bell.focus(); }
  });
  document.getElementById("nread").onclick=function(){
    var i=+document.getElementById("newsbar").dataset.ev; markSeen(); openEvent(i);
  };
  document.getElementById("nclose").onclick=function(){
    var nb=document.getElementById("newsbar"); nb.dataset.dismissed="1"; markSeen();
  };
  renderBell();
})();
function openEvent(i){
  var e=EV[i]; if(!e)return;
  document.getElementById("de-title").textContent=e.title;
  var c=chipsOf(e);
  document.getElementById("evbody").innerHTML=
    '<div class="tl-when"><span class="tl-date">'+esc(e.date)+'</span><span class="tl-rel">'+rel(e.date)+'</span></div>'+
    '<p class="tl-sum">'+esc(e.summary)+'</p>'+
    (c?'<div class="tl-chips">'+c+'</div>':'')+
    (e.body?'<p class="ev-body">'+esc(e.body)+'</p>':'');
  openDlg("dlg-event","event-"+e.date);
}

/* ---------- points by source ---------- */
var SRC=D.sources||null, PCOL={}, PORDER=[];
if(SRC){
  var ptot={};
  SRC.labels.forEach(function(l,i){ ptot[l[0]]=(ptot[l[0]]||0)+SRC.pts[i]; });
  PORDER=Object.keys(ptot).sort(function(x,y){return ptot[y]-ptot[x];});
  var ci=1;
  PORDER.forEach(function(p){ PCOL[p]= (p==="Not itemised"||ci>6) ? "var(--c0)" : "var(--c"+(ci++)+")"; });
}
function srcRateNote(){
  if(!SRC)return "";
  return SRC.rate
    ? "Per-day figures by source are measured over "+(Math.round(SRC.rateDays*10)/10)+" days, "+SRC.rateFrom+" → "+SRC.asOf+"."
    : "Earning by source needs two daily breakdown snapshots, so per-day figures by source appear from the next update.";
}
/* group [labelIndex, value] pairs (and optional rates) into protocol → products */
function groupSources(pairs,rates){
  var g={}, total=0, rmap={};
  for(var i=0;i<(rates||[]).length;i+=2)rmap[rates[i]]=rates[i+1];
  for(var j=0;j<pairs.length;j+=2){
    var k=pairs[j], v=pairs[j+1], l=SRC.labels[k];
    total+=v;
    (g[l[0]]=g[l[0]]||{p:l[0],v:0,r:0,items:[]});
    g[l[0]].v+=v; g[l[0]].r+=(rmap[k]||0);
    g[l[0]].items.push({k:k,n:l[1],v:v,r:rmap[k]||0});
  }
  var out=Object.keys(g).map(function(p){return g[p];}).sort(function(x,y){return y.v-x.v;});
  out.forEach(function(x){x.items.sort(function(m,n){return n.v-m.v;});});
  return {groups:out,total:total};
}
function sh1(x){return x>0&&x<0.001?"<0.1%":pct(x,1);}
function srcTable(G,opts){
  var hasRate=opts.rate, hasW=opts.wallets;
  var head='<thead><tr><th>Source</th><th>Points</th><th>Share</th>'+(hasW?'<th>Wallets</th>':'')+(hasRate?'<th>Per day</th>':'')+'</tr></thead>';
  var body=G.groups.map(function(gr){
    var share=G.total?gr.v/G.total:0, col=PCOL[gr.p]||"var(--c0)";
    var r='<tr class="proto"><td><span class="pname"><span class="sw" style="background:'+col+'"></span>'+esc(gr.p)+'</span></td><td class="n">'+n(gr.v)+
      '</td><td class="n share">'+sh1(share)+'<span class="meter"><i style="width:'+(share*100).toFixed(1)+'%;background:'+col+'"></i></span></td>'+
      (hasW?'<td class="n">'+(SRC.protoWallets&&SRC.protoWallets[gr.p]!=null?n(SRC.protoWallets[gr.p]):"")+'</td>':'')+(hasRate?'<td class="n">'+(gr.r>0?"+"+compact(gr.r):"—")+'</td>':'')+'</tr>';
    return r+gr.items.map(function(it){
      var s2=G.total?it.v/G.total:0;
      return '<tr><td class="prod">'+esc(it.n)+'</td><td class="n">'+n(it.v)+'</td><td class="n share">'+sh1(s2)+
        '<span class="meter"><i style="width:'+(s2*100).toFixed(1)+'%;background:'+col+'"></i></span></td>'+
        (hasW?'<td class="n">'+n(SRC.wallets[it.k])+'</td>':'')+
        (hasRate?'<td class="n" style="color:'+(it.r>0?"var(--good)":"var(--faint)")+'">'+(it.r>0?"+"+compact(it.r):"—")+'</td>':'')+'</tr>';
    }).join("");
  }).join("");
  return head+'<tbody>'+body+'</tbody>';
}
(function(){
  if(!SRC){document.getElementById("src-sec").hidden=true; return;}
  var pairs=[], rates=[];
  SRC.labels.forEach(function(l,i){ pairs.push(i,SRC.pts[i]); if(SRC.rate)rates.push(i,SRC.rate[i]); });
  var G=groupSources(pairs,rates);
  document.getElementById("srcbar").innerHTML=G.groups.map(function(gr){
    return '<span title="'+esc(gr.p)+': '+pct(gr.v/G.total,1)+'" style="flex:'+gr.v+' 0 0;background:'+PCOL[gr.p]+'"></span>';
  }).join("");
  document.getElementById("srcbar").setAttribute("aria-label","Share of all points by protocol");
  var topShare=G.groups.length?G.groups[0].v/G.total:1;
  document.getElementById("srclegend").innerHTML=G.groups.map(function(gr){
    var s=gr.v/G.total;
    return '<div class="srcrow"><span class="nm"><span class="sw" style="background:'+PCOL[gr.p]+'"></span>'+esc(gr.p)+'</span>'+
      '<span class="bar"><i style="width:'+(s/topShare*100).toFixed(1)+'%;background:'+PCOL[gr.p]+'"></i></span>'+
      '<b>'+sh1(s)+'</b></div>';
  }).join("");
  document.getElementById("srcnote").textContent="Share of every point ever credited, as itemised by OnRe on "+SRC.asOf+".";
  document.getElementById("srclead").textContent="All "+n(G.total)+" points across "+n(N)+" wallets, split by the protocol and product OnRe credits them to. "+srcRateNote();
  document.getElementById("srctable").innerHTML=srcTable(G,{rate:!!SRC.rate,wallets:true});
  document.getElementById("srcbtn").onclick=function(){openDlg("dlg-sources","sources");};
})();
function walletSources(idx){
  if(!SRC||!FULL.bd)return "";
  var pairs=FULL.bd[idx]||[], rates=FULL.br?(FULL.br[idx]||[]):null;
  if(!pairs.length)return '<div class="srcwrap"><h3>Where this wallet’s points come from</h3><p class="note">No itemisation for this wallet in the '+SRC.asOf+' breakdown.</p></div>';
  var G=groupSources(pairs,rates);
  var bar='<div class="srcbar" role="img" aria-label="This wallet’s points by protocol">'+G.groups.map(function(gr){
    return '<span title="'+esc(gr.p)+': '+pct(gr.v/G.total,1)+'" style="flex:'+gr.v+' 0 0;background:'+PCOL[gr.p]+'"></span>';}).join("")+'</div>';
  return '<div class="srcwrap"><h3>Where this wallet’s points come from</h3>'+bar+
    '<div class="tscroll" style="margin-top:12px"><table class="srct">'+srcTable(G,{rate:!!rates,wallets:false})+'</table></div>'+
    '<p class="hint">'+esc(srcRateNote())+'</p></div>';
}

/* ---------- concentration donut ---------- */
(function(){
  var cuts=[[1,10,"Top 10"],[11,100,"11–100"],[101,1000,"101–1,000"],[1001,10000,"1,001–10,000"],[10001,N,"Everyone else"]];
  var mix=[100,66,40,22,10], tiers=[], sum=0;
  cuts.forEach(function(c,i){
    if(c[0]>N)return;
    var hi=Math.min(c[1],N), s=0; for(var j=c[0]-1;j<hi;j++)s+=FULL.pts[j];
    sum+=s; tiers.push({label:c[2],from:c[0],to:hi,pts:s,
      col:"color-mix(in srgb, var(--hold) "+mix[i]+"%, var(--surface-2))"});
  });
  var R=70, C=2*Math.PI*R, off=0, arcs=[];
  tiers.forEach(function(t){
    var len=t.pts/sum*C;
    arcs.push('<circle cx="90" cy="90" r="'+R+'" fill="none" stroke="'+t.col+'" stroke-width="26" '+
      'stroke-dasharray="'+Math.max(0,len-1.5).toFixed(2)+' '+C.toFixed(2)+'" stroke-dashoffset="'+(-off).toFixed(2)+'" '+
      'transform="rotate(-90 90 90)"><title>'+t.label+': '+pct(t.pts/sum,1)+'</title></circle>');
    off+=len;
  });
  var top100=(tiers[0]?tiers[0].pts:0)+(tiers[1]?tiers[1].pts:0);
  document.getElementById("conc-chart").innerHTML='<svg viewBox="0 0 180 180" role="img" aria-label="Share of all points by wallet rank tier">'+
    '<circle cx="90" cy="90" r="'+R+'" fill="none" stroke="var(--surface-2)" stroke-width="26"/>'+arcs.join("")+
    '<text x="90" y="86" text-anchor="middle" fill="var(--ink)" font-family="Plus Jakarta Sans, Inter, sans-serif" font-weight="600" font-size="24">'+pct(top100/sum,1)+'</text>'+
    '<text x="90" y="106" text-anchor="middle" fill="var(--muted)" font-family="IBM Plex Mono, monospace" font-size="9.5" letter-spacing=".5">HELD BY TOP 100</text></svg>';
  document.getElementById("conc-legend").innerHTML=tiers.map(function(t){
    return '<div class="crow"><span class="sw" style="background:'+t.col+'"></span><span class="cl">'+t.label+
      '<small>'+n(t.to-t.from+1)+' wallets</small></span><b>'+pct(t.pts/sum,1)+'</b></div>';
  }).join("");
  document.getElementById("conc-note").textContent="Rank #1 alone holds "+pct(FULL.pts[0]/sum,1)+
    " of all points. The bottom "+n(Math.max(0,N-1000))+" wallets together hold "+pct(tiers.slice(3).reduce(function(x,t){return x+t.pts;},0)/sum,1)+".";
})();

/* ---------- top 10 ---------- */
function rowRate(rt){
  return '<td class="n" style="color:'+(rt>0?"var(--good)":"var(--faint)")+'">'+(rt>0?"+"+compact(rt):"—")+'</td>';
}
document.getElementById("top10").innerHTML=Array.apply(null,Array(Math.min(10,N))).map(function(_,i){
  return '<tr class="clickable" tabindex="0" data-i="'+i+'"><td class="rk">#'+(i+1)+'</td><td class="a l">'+short(addrAt(i))+
    '</td><td class="n">'+compact(ptsAt(i))+'</td>'+rowRate(rtsAt(i))+'</tr>';
}).join("");
document.getElementById("allbtn").textContent="See all "+n(N)+" wallets";
document.getElementById("lookcount").textContent=n(N)+" wallets in this snapshot";
document.getElementById("allbtn").onclick=function(){openStandings();};

/* ---------- projection + calculator ---------- */
var HOR=[7,30,90,180];
function rankAt(idx,days){
  var mine=ptsAt(idx)+rtsAt(idx)*days, r=1, P=FULL.pts, R=FULL.rts;
  for(var j=0;j<N;j++){ if(P[j]+R[j]*days>mine)r++; }
  return r;
}
var CALC_DEFAULTS={fdv:300,alloc:5,tge:100,months:0};
function calcMarkup(){
  var s=CALC_DEFAULTS;
  try{var v=JSON.parse(localStorage.getItem("onre-calc")||"null"); if(v)s=v;}catch(e){}
  function ctl(id,label,min,max,step,val){
    return '<div class="ctl"><label for="c-'+id+'">'+label+' <b id="c-'+id+'-v"></b></label>'+
      '<input type="range" id="c-'+id+'" min="'+min+'" max="'+max+'" step="'+step+'" value="'+val+'"></div>';
  }
  return '<div class="calc">'+
    '<div class="calc-out"><span class="k">Estimated airdrop value</span>'+
      '<span class="v" id="c-out">—</span>'+
      '<span class="split" id="c-split"></span>'+
      '<span class="formula" id="c-formula"></span></div>'+
    '<div class="calc-grid">'+
      ctl("fdv","Fully diluted valuation",25,2000,25,s.fdv)+
      ctl("alloc","Airdrop allocation",1,30,0.5,s.alloc)+
      ctl("tge","Unlocked at launch",10,100,5,s.tge)+
      ctl("months","Hold for",0,18,1,s.months)+
    '</div>'+
    '<p class="calc-assume" id="c-assume"></p>'+
  '</div>';
}
function wireCalc(points,rate){
  var ids=["fdv","alloc","tge","months"], el={};
  ids.forEach(function(k){el[k]=document.getElementById("c-"+k);});
  function usd(x){
    if(x>=1e9)return "$"+(x/1e9).toFixed(2)+"B";
    if(x>=1e6)return "$"+(x/1e6).toFixed(2)+"M";
    if(x>=1e3)return "$"+(x/1e3).toFixed(1)+"K";
    return "$"+x.toFixed(0);
  }
  function tidy(x){return x.toFixed(1).replace(/\.0$/,"");}
  function run(){
    var fdv=+el.fdv.value*1e6, alloc=+el.alloc.value/100, tge=+el.tge.value/100, mo=+el.months.value;
    document.getElementById("c-fdv-v").textContent=usd(fdv);
    document.getElementById("c-alloc-v").textContent=tidy(+el.alloc.value)+"%";
    document.getElementById("c-tge-v").textContent=Math.round(tge*100)+"%";
    document.getElementById("c-months-v").textContent=mo===0?"no hold":mo+(mo===1?" month":" months");
    try{localStorage.setItem("onre-calc",JSON.stringify(
      {fdv:+el.fdv.value,alloc:+el.alloc.value,tge:+el.tge.value,months:mo}));}catch(e){}

    var days=Math.round(mo*30.44);
    var myPts=points+rate*days, sysPts=D.system+D.totalRate*days;
    var share=myPts/sysPts, value=fdv*alloc*share;

    document.getElementById("c-out").textContent=usd(value);
    document.getElementById("c-split").textContent = tge<1
      ? usd(value*tge)+" liquid at launch · "+usd(value*(1-tge))+" vesting"
      : "fully liquid at launch";
    document.getElementById("c-formula").textContent=
      usd(fdv)+" × "+tidy(+el.alloc.value)+"% allocation × "+(share*100).toFixed(4)+"% share";

    var a=document.getElementById("c-assume");
    if(days===0){
      a.innerHTML="Share held flat at today’s <b>"+(share*100).toFixed(4)+"%</b>. "+
        "Move the hold slider to carry this wallet and the whole population forward together.";
    }else{
      var now=points/D.system, drift=(share/now-1)*100;
      a.innerHTML="Over "+mo+(mo===1?" month":" months")+" this wallet earns <b>"+compact(rate*days)+
        "</b> more points while the whole population adds <b>"+compact(D.totalRate*days)+
        "</b>, moving its share from <b>"+(now*100).toFixed(4)+"%</b> to <b>"+(share*100).toFixed(4)+
        "%</b> ("+(drift>=0?"+":"")+drift.toFixed(1)+"%). Both sides are carried at rates measured "+
        "over "+(D.rateDays===1?"a single day":D.rateDays+" days")+", held constant. Emission is "+
        "assumed steady at <b>"+compact(D.totalRate)+"</b>/day, which it has not been.";
    }
  }
  ids.forEach(function(k){el[k].addEventListener("input",run);});
  run();
}
function openWallet(idx){
  var addr=addrAt(idx), p=ptsAt(idx), rate=rtsAt(idx), rank=idx+1;
  var share=p/D.system, pctile=(1-idx/N)*100, known=seenAt(idx)===1;
  var st = !known ? ['flat','New in this window']
         : rate===0 ? ['warn','No credit in window']
         : ['good','Accruing '+compact(rate)+'/day'];
  var rows=HOR.map(function(d){
    var r=rankAt(idx,d), dr=rank-r;
    var badge = dr>0?'<span class="pill good">+'+n(dr)+'</span>'
              : dr<0?'<span class="pill bad">'+n(dr)+'</span>'
              : '<span class="pill flat">even</span>';
    return '<tr><td>'+d+' days</td><td class="n">'+n(p+rate*d)+'</td><td class="n">#'+n(r)+
           '</td><td>'+badge+'</td></tr>';
  }).join("");
  var caution = (rate===0&&known)
    ? '<p class="note"><strong>This wallet shows no credit in the measurement window.</strong> '+
      'Points post in batches, so a wallet can read zero and resume later. The table '+
      'treats the rate as zero, which is too low if the wallet is still active.</p>'
    : '<p class="note"><strong>Straight-line arithmetic, not a forecast.</strong> Every wallet is carried '+
      'forward at its own measured rate ('+rateWindow()+'), which assumes nobody enters, exits or '+
      'changes position. Reward programmes change without notice.</p>';
  document.getElementById("dw-title").textContent="Rank #"+n(rank);
  document.getElementById("result").innerHTML=
    '<div class="projwrap wgrid"><div class="wmain">'+
      '<div class="addr-line"><span class="a mono" id="w-addr">'+addr+'</span>'+
      '<button class="copy" type="button" id="w-copy">Copy</button>'+
      '<span class="pill '+st[0]+'">'+st[1]+'</span></div>'+
      '<div class="rgrid">'+
        '<div class="stat"><span class="k">Rank</span><span class="v">#'+n(rank)+
          '</span><span class="s">top '+(pctile>=99.9?pctile.toFixed(2):pctile.toFixed(1))+'%</span></div>'+
        '<div class="stat"><span class="k">Points</span><span class="v">'+compact(p)+
          '</span><span class="s">'+n(p)+'</span></div>'+
        '<div class="stat"><span class="k">Share of supply</span><span class="v">'+pct(share)+
          '</span><span class="s">of '+compact(D.system)+'</span></div>'+
        '<div class="stat"><span class="k">Measured / day</span><span class="v">'+compact(rate)+
          '</span><span class="s">'+(Math.round(D.rateDays*10)/10)+'-day average</span></div>'+
      '</div>'+
      '<div class="tscroll" style="margin-top:18px"><table>'+
        '<thead><tr><th>Horizon</th><th>Points</th><th>Rank</th><th>Move</th></tr></thead>'+
        '<tbody>'+rows+'</tbody></table></div>'+
      caution+
      calcMarkup()+
    '</div><div class="wside">'+walletSources(idx)+'</div></div>';
  wireCalc(p,rate);
  document.getElementById("w-copy").onclick=function(){
    var b=this;
    function sel(){ var r=document.createRange(); r.selectNodeContents(document.getElementById("w-addr"));
      var s=getSelection(); s.removeAllRanges(); s.addRange(r); b.textContent="Selected"; }
    try{ navigator.clipboard.writeText(addr).then(function(){b.textContent="Copied";},sel); }catch(e){ sel(); }
  };
  openDlg("dlg-wallet","w-"+addr);
}

/* ---------- lookup ---------- */
var errEl=document.getElementById("err"), byAddr={};
for(var i=0;i<N;i++)byAddr[addrAt(i)]=i;
function doLookup(v){
  v=(v||"").trim(); errEl.hidden=true;
  if(!v)return false;
  var idx=byAddr[v];
  if(idx===undefined){
    errEl.textContent="That address isn't in this snapshot. Check it was copied in full, or the wallet may not hold any points yet.";
    errEl.hidden=false;
    return false;
  }
  openWallet(idx); return true;
}
document.getElementById("lform").addEventListener("submit",function(e){
  e.preventDefault(); doLookup(document.getElementById("waddr").value);
});
var seedA=addrAt(0), seedB=addrAt(Math.min(49,N-1));
document.getElementById("hint").innerHTML="Try <code data-a=\""+seedA+"\">"+short(seedA)+
  "</code> (rank 1) or <code data-a=\""+seedB+"\">"+short(seedB)+"</code> (rank "+Math.min(50,N)+").";
document.getElementById("hint").addEventListener("click",function(e){
  var c=e.target.closest("code"); if(!c)return;
  document.getElementById("waddr").value=c.dataset.a; doLookup(c.dataset.a);
});

/* ---------- standings ---------- */
var PAGE=100, page=0, filtered=null;
function total(){ return filtered?filtered.length:N; }
function idxAt(i){ return filtered?filtered[i]:i; }
function renderLB(){
  var tot=total(), pages=Math.max(1,Math.ceil(tot/PAGE));
  if(page>=pages)page=pages-1; if(page<0)page=0;
  var start=page*PAGE, end=Math.min(tot,start+PAGE), out=[];
  for(var i=start;i<end;i++){
    var ix=idxAt(i);
    out.push('<tr class="clickable'+(ix===hit?' hit':'')+'" tabindex="0" data-i="'+ix+'"><td class="rk">#'+n(ix+1)+'</td><td class="a l"><span class="addr-full">'+addrAt(ix)+'</span><span class="addr-short">'+short(addrAt(ix))+'</span>'+
      '</td><td class="n">'+n(ptsAt(ix))+'</td><td class="n">'+pct(ptsAt(ix)/D.system,4)+'</td>'+rowRate(rtsAt(ix))+'</tr>');
  }
  document.getElementById("lbbody").innerHTML=out.join("")||
    '<tr><td colspan="5" style="text-align:center;color:var(--muted);padding:26px">No wallet matches that filter.</td></tr>';
  document.getElementById("pinfo").textContent=tot?((start+1)+"–"+end+" of "+n(tot)):"0 of 0";
  document.getElementById("pprev").disabled=page===0;
  document.getElementById("pnext").disabled=page>=pages-1;
}
function openStandings(){ renderLB(); openDlg("dlg-standings","standings"); }
document.getElementById("lbsub").textContent=
  n(N)+" wallets hold points. Ranks and per-day figures are from the "+D.asOf+" snapshot. Select any row to open that wallet.";
document.getElementById("pprev").onclick=function(){page--;renderLB();document.getElementById("dlg-standings").scrollTop=0;};
document.getElementById("pnext").onclick=function(){page++;renderLB();document.getElementById("dlg-standings").scrollTop=0;};
var qt, hit=-1;
var lbq=document.getElementById("lbq"), lbclear=document.getElementById("lbclear"), lbstatus=document.getElementById("lbstatus");
function scrollToHit(){
  var row=document.querySelector('#lbbody tr[data-i="'+hit+'"]');
  if(row)row.scrollIntoView({block:"center"});
}
function runSearch(){
  var raw=lbq.value.trim(), q=raw.toLowerCase(), rk=/^#?\d+$/.test(raw)?parseInt(raw.replace("#",""),10):NaN;
  lbclear.hidden=!raw; hit=-1;
  if(!raw){ filtered=null; page=0; lbstatus.textContent=""; renderLB(); return; }
  if(!isNaN(rk)){
    filtered=null;
    if(rk<1||rk>N){ lbstatus.textContent="Ranks run from 1 to "+n(N)+"."; renderLB(); return; }
    hit=rk-1; page=Math.floor(hit/PAGE);
    lbstatus.textContent="Rank #"+n(rk)+" highlighted · press Enter to open it";
    renderLB(); scrollToHit(); return;
  }
  filtered=[];
  for(var i=0;i<N&&filtered.length<5000;i++){
    if(addrAt(i).toLowerCase().indexOf(q)!==-1)filtered.push(i);
  }
  if(filtered.length===1)hit=filtered[0];
  page=0;
  lbstatus.textContent = !filtered.length ? "No wallet address contains “"+raw+"”."
    : filtered.length===1 ? "1 wallet matches · press Enter to open it"
    : (filtered.length>=5000?"5,000+":n(filtered.length))+" wallets match";
  renderLB();
}
lbq.addEventListener("input",function(){ clearTimeout(qt); qt=setTimeout(runSearch,140); });
document.getElementById("lbform").addEventListener("submit",function(e){
  e.preventDefault(); clearTimeout(qt); runSearch();
  if(hit>=0)openWallet(hit);
});
lbclear.onclick=function(){ lbq.value=""; runSearch(); lbq.focus(); };
function rowOpen(e){
  var tr=e.target.closest("tr[data-i]"); if(!tr)return;
  if(e.type==="keydown"&&e.key!=="Enter"&&e.key!==" ")return;
  e.preventDefault(); openWallet(+tr.dataset.i);
}
["lbbody","top10"].forEach(function(id){
  var el=document.getElementById(id);
  el.addEventListener("click",rowOpen); el.addEventListener("keydown",rowOpen);
});

/* ---------- builder credit + referral ---------- */
(function(){
  var site=D.site||{};
  var x=(site.twitter||"").replace(/^@/,"");
  if(/^[A-Za-z0-9_]{1,15}$/.test(x)){
    var url="https://x.com/"+x, bl=document.getElementById("byline"), fx=document.getElementById("footx");
    bl.href=url; bl.textContent="by @"+x; bl.hidden=false;
    fx.href=url; fx.textContent="@"+x; document.getElementById("footby").hidden=false;
  }
  var ref=site.referral||{};
  if(ref.code){
    document.getElementById("refcode").textContent=ref.code;
    if(ref.url&&/^https:\/\//.test(ref.url)){ var rl=document.getElementById("reflink"); rl.href=ref.url; rl.hidden=false; }
    document.getElementById("refcopy").onclick=function(){
      var b=this;
      function sel(){ var r=document.createRange(); r.selectNodeContents(document.getElementById("refcode"));
        var s=getSelection(); s.removeAllRanges(); s.addRange(r); b.textContent="Selected"; }
      try{ navigator.clipboard.writeText(ref.code).then(function(){b.textContent="Copied";},sel); }catch(e){ sel(); }
    };
    document.getElementById("refcard").hidden=false;
  }
})();

/* ---------- about ---------- */
document.getElementById("aboutbtn").onclick=
document.getElementById("aboutbtn2").onclick=function(){openDlg("dlg-about","about");};

/* ---------- theme: dark by default, one button flips to light and back ---------- */
(function(){
  var root=document.documentElement, btn=document.getElementById("theme");
  function label(){
    var t=root.getAttribute("data-theme")==="light"?"Switch to dark theme":"Switch to light theme";
    btn.setAttribute("aria-label",t); btn.title=t;
  }
  try{ if(localStorage.getItem("onre-theme")==="light")root.setAttribute("data-theme","light"); }catch(e){}
  label();
  btn.onclick=function(){
    var light=root.getAttribute("data-theme")!=="light";
    if(light)root.setAttribute("data-theme","light"); else root.removeAttribute("data-theme");
    try{ light?localStorage.setItem("onre-theme","light"):localStorage.removeItem("onre-theme"); }catch(e){}
    label();
  };
})();

/* ---------- open whatever the link points at ---------- */
(function(){
  var h=(location.hash||"").slice(1);
  if(h.indexOf("w-")===0){ doLookup(h.slice(2)); }
  else if(h.indexOf("event-")===0){
    for(var i=0;i<EV.length;i++) if(EV[i].date===h.slice(6)){ openEvent(i); break; }
  }
  else if(h==="standings") openStandings();
  else if(h==="about") openDlg("dlg-about");
  else if(h==="sources"&&SRC) openDlg("dlg-sources");
})();
})();
