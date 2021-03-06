import { IApi, IRoute } from 'umi';
import { testPathWithPrefix, toArray } from '../common';
import { App } from '../types';
import { defaultHistoryType } from '../constants';

export default function modifyRoutes(api: IApi) {
  api.modifyRoutes(routes => {
    const { history, base } = api.config;
    const { master: { routeBindingAlias = 'microApp', apps = [] } = {} } =
      api.config.qiankun || {};
    const masterHistoryType = (history && history?.type) || defaultHistoryType;

    // 兼容以前的通过配置 base 自动注册应用的场景
    const registrableApps = apps.filter((app: App) => app.base);
    if (registrableApps.length) {
      useLegacyModifyRoutesWithRegistrableMode(
        routes,
        registrableApps,
        masterHistoryType,
      );
    }

    modifyRoutesWithAttachMode(routes, masterHistoryType, {
      routeBindingAlias,
      base: base || '/',
    });

    return routes;
  });
}

function modifyRoutesWithAttachMode(
  routes: IRoute[],
  masterHistoryType: string,
  opts: {
    routeBindingAlias?: string;
    base?: string;
  },
) {
  const normalizeJsonStringInUmiRoute = (str: string) =>
    str.replace(/\"/g, "'");

  const { routeBindingAlias = 'microApp', base = '/' } = opts;
  const patchRoutes = (routes: IRoute[]) => {
    if (routes.length) {
      routes.forEach(route => {
        // 当配置了 routeBindingAlias 时，优先从 routeBindingAlias 里取配置，但同时也兼容使用了默认的 microApp 方式
        const microAppName = route[routeBindingAlias] || route.microApp;
        const microAppProps =
          route[`${routeBindingAlias}Props`] || route.microAppProps || {};
        if (microAppName) {
          if (route.routes?.length) {
            throw new Error(
              '[@umijs/plugin-qiankun]: You can not attach micro app to a route who has children!',
            );
          }

          route.exact = false;
          const { settings = {}, ...componentProps } = microAppProps;
          // 兼容以前的 settings 配置
          const microAppSettings = route.settings || settings || {};
          route.component = `({match}: any) => {
            const { MicroApp, getCreateHistoryOptions } = umiExports as any;
            const { url } = match;

            // 默认取静态配置的 base
            let umiConfigBase = '${base === '/' ? '' : base}';
            // 存在 getCreateHistoryOptions 说明当前应用开启了 runtimeHistory，此时取运行时的 history 配置的 basename
            if (typeof getCreateHistoryOptions === 'function') {
              const { basename = '/' } = getCreateHistoryOptions();
              umiConfigBase = basename === '/' ? '' : basename;
            }

            const runtimeMatchedBase = umiConfigBase + (url.endsWith('/') ? url.substr(0, url.length - 1) : url);

            return React.createElement(
              MicroApp,
              {
                name: '${microAppName}',
                base: runtimeMatchedBase,
                history: '${masterHistoryType}',
                settings: ${normalizeJsonStringInUmiRoute(
                  JSON.stringify(microAppSettings),
                )},
                ...${normalizeJsonStringInUmiRoute(
                  JSON.stringify(componentProps),
                )}
              },
            );
          }`;
        }

        if (route.routes?.length) {
          patchRoutes(route.routes);
        }
      });
    }
  };

  patchRoutes(routes);

  return routes;
}

/**
 * 1.x 版本使用 base 配置加载微应用的方式
 * @param routes
 * @param apps
 * @param masterHistoryType
 */
function useLegacyModifyRoutesWithRegistrableMode(
  routes: IRoute[],
  apps: App[],
  masterHistoryType: string,
) {
  // 获取一组路由中以 basePath 为前缀的路由
  const findRouteWithPrefix = (
    routes: IRoute[],
    basePath: string,
  ): IRoute | null => {
    // eslint-disable-next-line no-restricted-syntax
    for (const route of routes) {
      if (route.path && testPathWithPrefix(basePath, route.path)) return route;

      if (route.routes && route.routes.length) {
        return findRouteWithPrefix(route.routes, basePath);
      }
    }

    return null;
  };

  return routes.map(route => {
    if (route.path === '/' && route.routes && route.routes.length) {
      apps.forEach(({ history: slaveHistory = masterHistoryType, base }) => {
        if (!base) {
          return;
        }

        // 当子应用的 history mode 跟主应用一致时，为避免出现 404 手动为主应用创建一个 path 为 子应用 rule 的空 div 路由组件
        if (slaveHistory === masterHistoryType) {
          const baseConfig = toArray(base);

          baseConfig.forEach(basePath => {
            const routeWithPrefix = findRouteWithPrefix(routes, basePath);

            // 应用没有自己配置过 basePath 相关路由，则自动加入 mock 的路由
            if (!routeWithPrefix) {
              route.routes!.unshift({
                path: basePath,
                exact: false,
                component: `() => {
                        if (process.env.NODE_ENV === 'development') {
                          console.log('${basePath} 404 mock rendered');
                        }

                        const React = require('react');
                        return React.createElement('div');
                      }`,
              });
            } else {
              // 若用户已配置过跟应用 base 重名的路由，则强制将该路由 exact 设置为 false，目的是兼容之前遗留的错误用法的场景
              routeWithPrefix.exact = false;
            }
          });
        }
      });
    }

    return route;
  });
}
