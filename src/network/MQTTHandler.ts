//import { device as awsIoTDevice } from 'aws-iot-device-sdk';
var awsIot = require('aws-iot-device-sdk');
import { GoveeAPIConfig, GoveeHomebridgePlatform } from '../platform';
import { caCert, clientCert, privateKey } from './MQTTCertificates';

export class MQTTHandler {
	mqttClient;
	constructor(
		private readonly goveeConfig: GoveeAPIConfig,
		private readonly platform: GoveeHomebridgePlatform
	) {
		/**
		 * setup connection to the MQTT client
		 */
		this.mqttClient = awsIot.device({
			host: 'aqm3wd1qlc3dy-ats.iot.us-east-1.amazonaws.com',
			clientId: this.goveeConfig.clientId,
			caCert: Buffer.from(caCert, 'utf-8'),
			clientCert: Buffer.from(clientCert, 'utf-8'),
			privateKey: Buffer.from(privateKey, 'utf-8'),
			/*caPath:
				this.platform.config.caPath ?? __dirname + '/cert/AmazonRootCA1.pem',
			certPath:
				this.platform.config.certPath ?? __dirname + '/cert/testiot.cert.pem',
			keyPath:
				this.platform.config.keyPath ?? __dirname + '/cert/testiot.cert.pkey',*/
		});

		///home/pi/govee
		/**
		 * MQTT client is connected to its endpoint
		 */
		this.mqttClient.on('connect', () => {
			this.platform.log.debug('MQTT client connected');
			// subscribe to all messages regarding the account topic
			this.mqttClient.subscribe(this.goveeConfig.topic);
		});

		/**
		 * the MQTT client received a new message
		 */
		this.mqttClient.on('message', (topic, message) => {
			this.platform.log.debug('MQTT client received a message');
			// parse the message into a json object
			const messageJSON = JSON.parse(message);

			// Id of the device
			var deviceId;

			/*
			Why does the following `if` statement exist?
			============================================

			Govee did something weird here. Sometimes the device info is in the "root" of the json, sometimes it's inside a "msg" key.
			To find out, we check if this key exists
			*/
			if (messageJSON.hasOwnProperty('msg')) {
				const parsedMsg = JSON.parse(messageJSON.msg);
				deviceId = parsedMsg.device ?? '';
			} else {
				deviceId = messageJSON.device ?? '';
			}

			// check if the message contains a state, if not it's basically useless
			if (messageJSON.hasOwnProperty('state')) {
				// find the device by its id in the `currentAccessories` array (all current devices)
				const deviceIndexById = this.platform.currentAccessories.findIndex(
					(e) => e.information.id == deviceId
				);

				// JavaScript returns -1 if there's no element, so if the index is below 0 (which -1 is), we return
				if (deviceIndexById < 0) return;

				// If the element if found, we give it the state to update its variables
				this.platform.currentAccessories[deviceIndexById].updateState(
					messageJSON.state
				);
			}

			// TODO
		});

		/**
		 * The MQTT client connection is closed
		 */
		this.mqttClient.on('close', () => {
			this.platform.log.warn('MQTT connection closed');
		});

		/**
		 * the MQTT client (or the endpoint?) went offline (idk, I never used Amazon IoT stuff before)
		 */
		this.mqttClient.on('offline', () => {
			this.platform.log.warn('MQTT conntection offline');
		});
	}

	/**
	 * Function to prepare the right format for a MQTT request and send it
	 * @param device device topic
	 * @param command command to be issued
	 * @param data data sent along with the command
	 */
	publish(device: string, command: string, data: object) {
		// create the payload...
		const payload = {
			msg: {
				accountTopic: this.goveeConfig.topic,
				cmd: command,
				cmdVersion: 0,
				data: data,
				transaction: Math.floor(+new Date()).toString(),
				type: 1,
			},
		};

		// ...and send it off on its way!
		this.mqttClient.publish(device, JSON.stringify(payload));
	}
}
