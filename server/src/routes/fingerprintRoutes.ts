/**
 * Fingerprint Routes - Fastify Plugin
 * Serves the lightweight browser fingerprint collector script for bot detection.
 * Public endpoint — no auth required (loaded on WooCommerce checkout pages).
 */

import { FastifyPluginAsync } from 'fastify';

/**
 * Minified fingerprint collector JS.
 *
 * Signals collected (all lightweight, <3ms total):
 * - Time from page load to form submit
 * - Pointer/touch event count (real users generate dozens)
 * - Keyboard event count
 * - Whether the tab was ever visible
 * - navigator.webdriver flag
 * - Screen vs viewport dimensions
 * - navigator.languages count
 *
 * The script attaches to WooCommerce checkout forms (classic and Blocks).
 * Token is base64-encoded JSON injected as a hidden field or request header.
 */
const COLLECTOR_JS = `(function(){
'use strict';
var s=document.currentScript,n=s&&s.getAttribute('data-nonce')||'';
if(!n)return;
var pc=0,kc=0,pt=0,kt=0,vis=!document.hidden,t0=Date.now();
document.addEventListener('pointermove',function(ev){if(ev&&ev.isTrusted)pc++},{passive:true});
document.addEventListener('pointerdown',function(ev){if(ev&&ev.isTrusted)pt++},{passive:true});
document.addEventListener('keydown',function(ev){kc++;if(ev&&ev.isTrusted)kt++},{passive:true});
document.addEventListener('visibilitychange',function(){if(!document.hidden)vis=true});
function sig(){
return{
n:n,
t:Date.now()-t0,
e:pc,
k:kc,
pt:pt,
kt:kt,
v:vis?1:0,
w:navigator.webdriver?1:0,
s:screen.width+'x'+screen.height+':'+window.innerWidth+'x'+window.innerHeight,
l:(navigator.languages||[]).length
}}
function encode(o){try{return btoa(JSON.stringify(o))}catch(e){return''}}
document.addEventListener('submit',function(ev){
var f=ev.target;
if(!f||!f.matches||!f.matches('form.checkout,form.wc-block-checkout__form'))return;
var tk=encode(sig());
if(!tk)return;
var fields=f.querySelectorAll('input[name="_os_fp"]'),inp=fields[0]||document.createElement('input');
for(var i=1;i<fields.length;i++)fields[i].remove();
inp.type='hidden';inp.name='_os_fp';inp.value=tk;
if(!inp.parentNode)f.appendChild(inp);
},true);
var origFetch=window.fetch;
if(typeof origFetch==='function')window.fetch=function(input,opts){
var config=opts;
try{
var req=typeof Request!=='undefined'&&input instanceof Request;
var url=new URL(req?input.url:String(input),window.location.href);
var method=String(opts&&opts.method||(req?input.method:'GET')).toUpperCase();
var route=url.searchParams.get('rest_route')||url.pathname;
if(url.origin===window.location.origin&&/^\\/(?:wp-json\\/)?wc\\/store\\/v[0-9]+\\/checkout\\/?$/.test(route)&&method==='POST'){
var headers=new Headers(opts&&opts.headers!==undefined?opts.headers:(req?input.headers:undefined));
var token=encode(sig());
if(token){headers.set('X-OS-FP',token);config=Object.assign({},opts,{headers:headers})}
}
}catch(e){}
return origFetch.call(this,input,config);
};
})();`;

const fingerprintRoutes: FastifyPluginAsync = async (fastify) => {
    /**
     * GET /api/fp/collect.js — Serves the fingerprint collector script.
     *
     * Loaded on WooCommerce checkout pages via a <script> tag injected by
     * the OverSeek WP plugin. The nonce is passed as a data attribute on
     * the script tag, not as a query parameter, to avoid cache key pollution.
     */
    fastify.get('/collect.js', async (_request, reply) => {
        reply
            .header('Content-Type', 'application/javascript; charset=utf-8')
            .header('Cache-Control', 'public, max-age=3600, immutable')
            .header('X-Content-Type-Options', 'nosniff')
            .send(COLLECTOR_JS);
    });
};

export default fingerprintRoutes;
