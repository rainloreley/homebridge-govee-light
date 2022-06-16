import { API } from 'homebridge';

import { PLATFORM_NAME } from './settings';
import { GoveeHomebridgePlatform } from './platform';

export = (api: API) => {
	// register the new Platform in Homebridge
	api.registerPlatform(PLATFORM_NAME, GoveeHomebridgePlatform);
};
