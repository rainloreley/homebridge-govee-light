import {
	API,
	DynamicPlatformPlugin,
	Logger,
	PlatformAccessory,
	PlatformConfig,
	Service,
	Characteristic,
} from 'homebridge';

import { PLATFORM_NAME, PLUGIN_NAME } from './settings';
import { GoveePlatformAccessory } from './platformAccessory';
import axios from 'axios';

import getDevices from './network/getDevices';
import { MQTTHandler } from './network/MQTTHandler';

export class GoveeHomebridgePlatform implements DynamicPlatformPlugin {
	public readonly Service: typeof Service = this.api.hap.Service;
	public readonly Characteristic: typeof Characteristic = this.api.hap
		.Characteristic;

	// Homebridge variable which contains cached accessories
	public readonly accessories: PlatformAccessory[] = [];
	// Array which contains all current devices
	public currentAccessories: GoveePlatformAccessory[] = [];
	// the current MQTT client
	public mqttClient: MQTTHandler;
	// the Govee API config (topic, token, clientId)
	public goveeAPIConfig: GoveeAPIConfig;

	constructor(
		public readonly log: Logger,
		public config: PlatformConfig,
		public readonly api: API
	) {
		this.log.debug('Finished initializing platform:', this.config.name);

		this.api.on('didFinishLaunching', () => {
			// Check for required config
			if (
				typeof this.config.email !== 'string' ||
				typeof this.config.password !== 'string'
			) {
				this.log.error(
					'The config is incomplete. Please refer to the plugin documentation for more information'
				);
				return;
			}
			this.loginToGovee();
		});
	}

	/**
	 * signs in to Govee (not their official API, it's their actual account endpoint!)
	 */
	async loginToGovee() {
		try {
			// sign in using data from the Homebridge config file
			const response = await axios.post(
				'https://app.govee.com/account/rest/account/v1/login',
				{
					client: this.config.client ?? '',
					email: this.config.email,
					password: this.config.password,
					key: '',
					transaction: Math.floor(+new Date()),
					view: 0,
				}
			);

			if (response.data.status == 200) {
				if (typeof this.config.client !== 'string') {
					this.log.warn(
						'Please copy the following ID and store it as "client" below your email and password in your Homebridge config file: ' +
							response.data.client.client
					);
				}
				// store the API config
				this.goveeAPIConfig = {
					token: response.data.client.token,
					topic: response.data.client.topic,
					clientId: response.data.client.client,
				};

				// setup an MQTT client
				this.mqttClient = new MQTTHandler(this.goveeAPIConfig, this);

				// proceed to search for devices
				this.discoverDevices();
			} else {
				this.log.error('Govee sign in failed!');
			}
		} catch (err) {
			this.log.error(err);
		}
	}

	/*async handleMQTTMessage(message) {
		const messageJSON = JSON.parse(message);

		var deviceId;

		if (messageJSON.hasOwnProperty('msg')) {
			const parsedMsg = JSON.parse(messageJSON.msg);
			deviceId = parsedMsg.device ?? '';
		} else {
			deviceId = messageJSON.device ?? '';
		}

		if (messageJSON.hasOwnProperty('state')) {
			const deviceIndexById = this.currentAccessories.findIndex(
				(e) => e.information.id == deviceId
			);
			if (deviceIndexById < 0) return;
			this.currentAccessories[deviceIndexById].updateState(messageJSON.state);
		}
	}*/

	/**
	 * Configures cached accessories (puts them into an array; Homebridge function)
	 * @param accessory a cached accessory
	 */
	configureAccessory(accessory: PlatformAccessory) {
		this.accessories.push(accessory);
	}

	/**
	 * Discovers/Searches for all devices on the Govee account
	 */
	async discoverDevices() {
		// Fetch devices
		const foundDevices = await getDevices(this.goveeAPIConfig.token);

		// run through all of them one by one
		for (const device of foundDevices) {
			// create a special Homebridge uuid for the device using its id
			const uuid = this.api.hap.uuid.generate(device.device);

			// check if this device is cached
			const existingAccessory = this.accessories.find(
				(accessory) => accessory.UUID == uuid
			);

			if (existingAccessory) {
				// put the device into the `currentAccessories` array
				this.currentAccessories.push(
					new GoveePlatformAccessory(
						this,
						existingAccessory,
						device,
						this.mqttClient
					)
				);
			} else {
				// creates new Homebridge accessory
				const accessory = new this.api.platformAccessory(
					device.deviceName,
					uuid
				);

				accessory.context.device = device;

				// put the device into the `currentAccessories` array
				this.currentAccessories.push(
					new GoveePlatformAccessory(this, accessory, device, this.mqttClient)
				);

				// register the new device in Homebridge
				this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [
					accessory,
				]);
			}
		}
	}
}

export interface GoveeAPIConfig {
	topic: string;
	token: string;
	clientId: string;
}
