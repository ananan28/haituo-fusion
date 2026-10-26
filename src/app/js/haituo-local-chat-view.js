'use strict';
// Compatibility entry. Resident controller owns rendering; no periodic reattachment.
const {installResident}=require('./haituo-wa-resident.js');
const {installHooks}=require('./haituo-wa-node-hooks.js');
function install(options){return installResident({...options,translate:options.translate||((text,id)=>options.retranslate(text,id)),installMainWorld:options.installMainWorld||(()=>installHooks({document:options.document,window:options.window}))})}
module.exports={install};
