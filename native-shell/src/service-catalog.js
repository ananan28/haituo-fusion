'use strict';

const RAW_CATALOG = [
  {
    id: 'signal', name: 'Signal', kind: 'native', adapter: 'signal',
    icon: 'S', color: '#3a76f0', startUrl: '', allowedHosts: []
  },
  {
    id: 'whatsapp', name: 'WhatsApp', kind: 'web', adapter: 'whatsapp',
    icon: 'W', color: '#13a45a', startUrl: 'https://web.whatsapp.com/',
    allowedHosts: ['whatsapp.com']
  },
  {
    id: 'telegram', name: 'Telegram', kind: 'web', adapter: 'web',
    icon: 'T', color: '#229ed9', startUrl: 'https://web.telegram.org/k/',
    allowedHosts: ['telegram.org']
  },
  {
    id: 'messenger', name: 'Messenger', kind: 'web', adapter: 'web',
    icon: 'M', color: '#168aff', startUrl: 'https://www.messenger.com/',
    allowedHosts: ['messenger.com', 'facebook.com', 'fb.com']
  },
  {
    id: 'instagram', name: 'Instagram', kind: 'web', adapter: 'web',
    icon: 'I', color: '#c13584', startUrl: 'https://www.instagram.com/direct/inbox/',
    allowedHosts: ['instagram.com', 'facebook.com']
  },
  {
    id: 'discord', name: 'Discord', kind: 'web', adapter: 'web',
    icon: 'D', color: '#5865f2', startUrl: 'https://discord.com/app',
    allowedHosts: ['discord.com']
  },
  {
    id: 'slack', name: 'Slack', kind: 'web', adapter: 'web',
    icon: 'S', color: '#611f69', startUrl: 'https://app.slack.com/client/',
    allowedHosts: ['slack.com']
  },
  {
    id: 'teams', name: 'Microsoft Teams', kind: 'web', adapter: 'web',
    icon: 'T', color: '#6264a7', startUrl: 'https://teams.microsoft.com/v2/',
    allowedHosts: ['teams.microsoft.com', 'microsoftonline.com', 'live.com', 'office.com']
  },
  {
    id: 'google-chat', name: 'Google Chat', kind: 'web', adapter: 'web',
    icon: 'G', color: '#0f9d58', startUrl: 'https://chat.google.com/',
    allowedHosts: ['google.com', 'googleusercontent.com']
  },
  {
    id: 'gmail', name: 'Gmail', kind: 'web', adapter: 'web',
    icon: 'G', color: '#ea4335', startUrl: 'https://mail.google.com/',
    allowedHosts: ['google.com', 'googleusercontent.com']
  },
  {
    id: 'outlook', name: 'Outlook', kind: 'web', adapter: 'web',
    icon: 'O', color: '#0078d4', startUrl: 'https://outlook.office.com/mail/',
    allowedHosts: ['office.com', 'office365.com', 'microsoftonline.com', 'live.com']
  },
  {
    id: 'linkedin', name: 'LinkedIn', kind: 'web', adapter: 'web',
    icon: 'L', color: '#0a66c2', startUrl: 'https://www.linkedin.com/messaging/',
    allowedHosts: ['linkedin.com']
  }
];

function freezeRecipe(recipe) {
  return Object.freeze({ ...recipe, allowedHosts: Object.freeze([...recipe.allowedHosts]) });
}

const SERVICE_CATALOG = Object.freeze(RAW_CATALOG.map(freezeRecipe));
const BY_ID = new Map(SERVICE_CATALOG.map(recipe => [recipe.id, recipe]));

function findRecipe(id) {
  return BY_ID.get(String(id || '')) || null;
}

function isAllowedNavigation(recipeOrId, value) {
  const recipe = typeof recipeOrId === 'string' ? findRecipe(recipeOrId) : recipeOrId;
  if (!recipe || recipe.kind !== 'web') return false;
  try {
    const target = new URL(value);
    if (target.protocol !== 'https:') return false;
    const host = target.hostname.toLowerCase().replace(/[.]$/, '');
    return recipe.allowedHosts.some(suffix => host === suffix || host.endsWith('.' + suffix));
  } catch {
    return false;
  }
}

function publicCatalog() {
  return SERVICE_CATALOG.map(({ allowedHosts, ...recipe }) => ({ ...recipe }));
}

module.exports = { SERVICE_CATALOG, findRecipe, isAllowedNavigation, publicCatalog };
