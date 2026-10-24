const { withEntitlementsPlist } = require('@expo/config-plugins');

const withoutPushEntitlement = (config) =>
  withEntitlementsPlist(config, (config) => {
    delete config.modResults['aps-environment'];
    return config;
  });

module.exports = { withoutPushEntitlement };
