'use strict';

const { findRecipe } = require('./service-catalog');

class AdapterRegistry {
  constructor({ signal, whatsapp, web, sendSignalRefresh }) {
    this.signal = signal;
    this.whatsapp = whatsapp;
    this.web = web;
    this.sendSignalRefresh = sendSignalRefresh;
  }

  recipe(service) {
    const recipe = service && findRecipe(service.recipeId);
    if (!recipe) throw new Error('服务类型不存在或已停用');
    return recipe;
  }

  setWindow(window) {
    this.whatsapp?.setWindow(window);
    this.web?.setWindow(window);
  }

  hide() {
    this.whatsapp?.hide();
    this.web?.hide();
  }

  resizeAll() {
    this.whatsapp?.resizeAll();
    this.web?.resizeAll();
  }

  async open(service) {
    const recipe = this.recipe(service);
    if (service.enabled === false) throw new Error(`该 ${service.name} 账号已停用，请先启用`);
    this.hide();
    if (recipe.adapter === 'signal') return true;
    if (recipe.adapter === 'whatsapp') return this.whatsapp.open(service.id);
    return this.web.open(service.id);
  }

  async refresh(service, mode = 'normal') {
    const recipe = this.recipe(service);
    if (recipe.adapter === 'signal') {
      const result = await this.signal.reconnect(service.id);
      this.sendSignalRefresh({ id: service.id, mode });
      return result;
    }
    if (recipe.adapter === 'whatsapp') return this.whatsapp.refresh(service.id, mode);
    return this.web.refresh(service.id, mode);
  }

  async remove(service, purge = true) {
    const recipe = this.recipe(service);
    if (recipe.adapter === 'signal') return this.signal?.removeAccount(service.id);
    if (recipe.adapter === 'whatsapp') return this.whatsapp.destroy(service.id, purge);
    return this.web.destroy(service.id, purge);
  }

  async update(service) {
    const recipe = this.recipe(service);
    if (recipe.adapter === 'signal') {
      if (!service.enabled) await this.signal?.stop(service.id);
      return true;
    }
    if (recipe.adapter === 'whatsapp') {
      if (!service.enabled) await this.whatsapp.destroy(service.id, false);
      return true;
    }
    return this.web.update(service);
  }

  accountForWebContents(webContents) {
    return this.whatsapp?.accountForWebContents(webContents) ||
      this.web?.accountForWebContents(webContents) || null;
  }

  async stopAll() {
    await Promise.all([
      this.signal ? this.signal.stopAll() : Promise.resolve(),
      this.whatsapp ? this.whatsapp.stopAll() : Promise.resolve(),
      this.web ? this.web.stopAll() : Promise.resolve()
    ]);
  }
}

module.exports = { AdapterRegistry };
