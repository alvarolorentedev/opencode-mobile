const { withEntitlementsPlist } = require('@expo/config-plugins');
const { withIOSLiveActivities } = require('./ios-live-activities.cjs');

const withoutPushEntitlement = (config) =>
  withEntitlementsPlist(config, (config) => {
    delete config.modResults['aps-environment'];
    return config;
  });

module.exports = { withoutPushEntitlement, withIOSLiveActivities };
