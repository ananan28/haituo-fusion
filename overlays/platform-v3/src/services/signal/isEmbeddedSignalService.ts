import type Service from '../../models/Service';

const SIGNAL_RECIPE_IDS = new Set(['signal', 'signal-native', 'caisheng-signal']);

/** 唯一入口判定：命中的服务永远不能创建 webview。 */
export function isEmbeddedSignalService(service: Service): boolean {
  const recipeId = service.recipe.id.toLowerCase();
  return (
    SIGNAL_RECIPE_IDS.has(recipeId) ||
    service.recipe.serviceURL.startsWith('caisheng://signal')
  );
}
