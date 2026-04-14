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
var pc=0,kc=0,vis=!document.hidden,t0=Date.now();
document.addEventListener('pointermove',function(){pc++},{passive:true});
document.addEventListener('keydown',function(){kc++},{passive:true});
document.addEventListener('visibilitychange',function(){if(!document.hidden)vis=true});
function sig(){
return{
n:n,
t:Date.now()-t0,
e:pc,
k:kc,
v:vis?1:0,
w:navigator.webdriver?1:0,
s:screen.width+'x'+screen.height+':'+window.innerWidth+'x'+window.innerHeight,
l:(navigator.languages||[]).length
}}
function encode(o){try{return btoa(JSON.stringify(o))}catch(e){return''}}
var f=document.querySelector('form.checkout,form.wc-block-checkout__form');
if(f){
f.addEventListener('submit',function(){
var tk=encode(sig());
if(!tk)return;
var inp=document.createElement('input');
inp.type='hidden';inp.name='_os_fp';inp.value=tk;
f.appendChild(inp);
},true);
}
var origFetch=window.fetch;
window.fetch=function(url,opts){
if(typeof url==='string'&&url.indexOf('/wc/store')!==-1&&url.indexOf('checkout')!==-1&&opts&&opts.method&&opts.method.toUpperCase()==='POST'){
opts.headers=opts.headers||{};
if(opts.headers instanceof Headers){opts.headers.set('X-OS-FP',encode(sig()))}
else if(Array.isArray(opts.headers)){opts.headers.push(['X-OS-FP',encode(sig())])}
else{opts.headers['X-OS-FP']=encode(sig())}
}
return origFetch.apply(this,arguments);
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
