import { Service, PlatformAccessory, CharacteristicValue } from 'homebridge';
import { MQTTHandler } from './network/MQTTHandler';
import { GoveeHomebridgePlatform } from './platform';
import { SINGLE_LETTER_COLOR_SKU } from './settings';

export class GoveePlatformAccessory {
	private service: Service;
	information: GoveePlatformAccessoryInformation;

	/**
	 * temporary variable to store the hue
	 */
	_newHue = {
		hueInternal: undefined,
		hueListener: function (val) {},
		set hue({ val, notify }) {
			this.hueInternal = val;
			if (notify === true) {
				this.hueListener(val);
			}
		},
		get hue() {
			return this.hueInternal;
		},
		registerListener: function (listener) {
			this.hueListener = listener;
		},
	};

	/**
	 * temporary variable to store the saturation
	 */
	_newSaturation = {
		satInternal: undefined,
		satListener: function (val) {},
		set saturation({ val, notify }) {
			this.satInternal = val;
			if (notify === true) {
				this.satListener(val);
			}
		},
		get saturation() {
			return this.satInternal;
		},
		registerListener: function (listener) {
			this.satListener = listener;
		},
	};

	constructor(
		private readonly platform: GoveeHomebridgePlatform,
		private readonly accessory: PlatformAccessory,
		newinformation,
		private readonly mqttClient: MQTTHandler
	) {
		// Use the information provided (id, sku,... to initialize the "information variable")
		this.information = new GoveePlatformAccessoryInformation(newinformation);

		// setup the accessory
		this.accessory
			.getService(this.platform.Service.AccessoryInformation)!
			.setCharacteristic(this.platform.Characteristic.Manufacturer, 'Govee')
			.setCharacteristic(
				this.platform.Characteristic.Model,
				this.information.sku
			)
			.setCharacteristic(
				this.platform.Characteristic.SerialNumber,
				this.information.id
			);

		// Create the lightbulb
		this.service =
			this.accessory.getService(this.platform.Service.Lightbulb) ||
			this.accessory.addService(this.platform.Service.Lightbulb);

		// add a name which is shown in the Home app
		this.service.setCharacteristic(
			this.platform.Characteristic.Name,
			this.information.name
		);

		// add a "set" and "get" function for the power state
		this.service
			.getCharacteristic(this.platform.Characteristic.On)
			.onSet(this.setOn.bind(this))
			.onGet(this.getOn.bind(this));

		// add a "set" and "get" function for the brightness
		this.service
			.getCharacteristic(this.platform.Characteristic.Brightness)
			.onSet(this.setBrightness.bind(this))
			.onGet(this.getBrightness.bind(this));

		// add a "set" and "get" function for the hue (color)
		this.service
			.getCharacteristic(this.platform.Characteristic.Hue)
			.onSet(this.setHue.bind(this))
			.onGet(this.getHue.bind(this));

		// add a "set" and "get" function for the saturation (color)
		this.service
			.getCharacteristic(this.platform.Characteristic.Saturation)
			.onSet(this.setSaturation.bind(this))
			.onGet(this.getSaturation.bind(this));

		// add a "set" and "get" function for the color temperature
		this.service
			.getCharacteristic(this.platform.Characteristic.ColorTemperature)
			.onSet(this.setColorTemperature.bind(this))
			.onGet(this.getColorTemperature.bind(this));

		// load the initial status from the api, usually turns off the device, can be fixed later?
		this.fetchStatus();

		this._newHue.registerListener((val) => {
			/*
			Why don't handle this in `setHue()`?
			=====================================

			Well, I did try that. But HomeKit sends both the hue AND the saturation as two different commands at the same time.
			This means that they override each other, and the color doesn't show correctly.
			To use both values at the same time, there are listeners for the variables.
			These variables contain the hue and saturation value every time they're sent.
			Usually these variables are set to `undefined`, and there's a reason for it:

			So we know that the commands for hue and saturation arrive at about the same time. We store that information
			in the variables, which fire the listeners. But we can only set the color if we have both values.
			What we do is we check if both values exist. Technically we only need to check for one because we just received the other one.
			To prevent delays, we set with to `undefined` without calling the listener after we're done using them.

			Then we just calculate the RGB values from the hue and saturation, we use 100% as the V (in HSV).
			We pack that information and send it off to the MQTT client.
			
			Done!
			*/

			const saturation = this._newSaturation.saturation;
			if (typeof saturation === 'number') {
				// great, we have both values
				// instantly set it back to undefined to not let the other one run
				this._newHue.hue = { val: undefined, notify: false };

				const rgb = HSVtoRGB(Number(val) / 360, saturation / 100, 1);
				this._newSaturation.saturation = { val: undefined, notify: false };
				const data = this.getRGBPack(rgb);
				this.mqttClient.publish(this.information.topic, 'color', data);
			}
		});

		this._newSaturation.registerListener((val) => {
			const hue = this._newHue.hue;
			if (typeof hue === 'number') {
				// great, we have both values
				// instantly set it back to undefined to not let the other one run
				this._newSaturation.saturation = { val: undefined, notify: false };

				const rgb = HSVtoRGB(hue / 360, Number(val) / 100, 1);
				this._newHue.hue = { val: undefined, notify: false };
				const data = this.getRGBPack(rgb);
				this.mqttClient.publish(this.information.topic, 'color', data);
			}
		});
	}

	/**
	 * handle requests from HomeKit to turn the device on or off
	 * @param value power state to be set
	 */
	async setOn(value: CharacteristicValue) {
		this.mqttClient.publish(this.information.topic, 'turn', { val: value });
	}

	/**
	 * fetch the power state
	 * @returns the power state
	 */
	async getOn(): Promise<CharacteristicValue> {
		return this.information.state?.on ?? false;
	}

	/**
	 * handle requests from HomeKit to change the brightness
	 * @param value brightness to be set (0-100)
	 */
	async setBrightness(value: CharacteristicValue) {
		// convert the brightness from 0-100 (HomeKit) to 0-255 (Govee)

		const brightnessValue = (Number(value) / 100) * 255;

		this.mqttClient.publish(this.information.topic, 'brightness', {
			val: brightnessValue,
		});
	}

	/**
	 * fetch the brightness
	 * @returns the current brightness
	 */
	async getBrightness(): Promise<CharacteristicValue> {
		// convert the brightness from 0-255 (Govee) to 0-100 (HomeKit)
		const brightness =
			(Number(this.information.state?.brightness ?? 0) / 255) * 100;
		return brightness;
	}

	// fetch the hue
	async getHue(): Promise<CharacteristicValue> {
		const _state = this.information.state ?? undefined;

		// check if there's even a state (might be undefined)
		if (_state != undefined) {
			// convert RGB (Govee) to HSV (needed by HomeKit)
			const hsv = RGBtoHSV(_state.color.r, _state.color.g, _state.color.b);
			return hsv.h;
		} else {
			return 100;
		}
	}

	/**
	 * handle requests from HomeKit to change the hue
	 * @param value hue to be set (0-360)
	 */
	async setHue(value: CharacteristicValue) {
		// set the temporary hue variable and notify the event listener
		this._newHue.hue = { val: Number(value), notify: true };
	}

	/**
	 * fetch the saturation
	 * @returns the current saturation
	 */
	async getSaturation(): Promise<CharacteristicValue> {
		const _state = this.information.state ?? undefined;
		if (_state != undefined) {
			const hsv = RGBtoHSV(_state.color.r, _state.color.g, _state.color.b);
			return hsv.s;
		} else {
			return 100;
		}
	}

	/**
	 * handle requests from HomeKit to change the hue
	 * @param value saturation to be set (0-100)
	 */
	async setSaturation(value: CharacteristicValue) {
		// set the temporary saturation variable and notify the event listener
		this._newSaturation.saturation = { val: Number(value), notify: true };
	}

	/**
	 * fetch the color temperature
	 * @returns the current color temperature
	 */
	async getColorTemperature(): Promise<CharacteristicValue> {
		var temp = this.information.state?.colorTemperatureKelvin ?? 0;

		/*
		convert the stored temperature (currently 2000-4000; Govee) to 140-500 (HomeKit).
		I used 2000-4000 instead of 2000-9000 because I did some tests and it fits more to the color temperature ring in the Home app.
		after 4000, nothing changed for me ¯\_(ツ)_/¯
		*/
		temp =
			(((-temp + (2000 + 4000) - 2000) * 100) / (9000 - 2000) / 100) *
				(500 - 140) +
			140;

		if (temp < 140) {
			// prevent temperature being too low
			temp = 140;
		} else if (temp > 500) {
			// prevent temperature being too high
			temp = 500;
		}
		return temp;
	}

	/**
	 * handle requests from HomeKit to set the color temperature
	 * @param value color temperature to be set
	 */
	async setColorTemperature(value: CharacteristicValue) {
		const min = 1000;
		const max = 40000;

		/*
		convert 140-500 (HomeKit) to 2000-4000 (Govee). Why did I use 2000-4000? I explained that in `getColorTemperature()`
		*/
		const temp =
			(((Number(-value + (140 + 500)) - 140) * 100) / (500 - 140) / 100) *
				(4000 - 2000) +
			2000;

		// convert the temperature to RGB values
		const kelvinValueInRGB = kelvin_to_rgb(temp);

		// put this data in the right format which can be sent to Govee
		var data = this.getRGBPack({
			r: kelvinValueInRGB.r,
			g: kelvinValueInRGB.g,
			b: kelvinValueInRGB.b,
		});

		// calculate the HSV values
		const hsv = RGBtoHSV(
			kelvinValueInRGB.r,
			kelvinValueInRGB.g,
			kelvinValueInRGB.b
		);

		// update the HSV values of the device
		this.service.updateCharacteristic(
			this.platform.Characteristic.Hue,
			hsv.h * 360
		);
		this.service.updateCharacteristic(
			this.platform.Characteristic.Saturation,
			hsv.s * 100
		);

		// update stored RGB values if there's a state yet
		const _state = this.information.state;
		if (_state !== undefined && _state !== null) {
			_state.color.r = kelvinValueInRGB.r;
			_state.color.g = kelvinValueInRGB.g;
			_state.color.b = kelvinValueInRGB.b;
			_state.colorTemperatureKelvin = temp;
		}

		this.mqttClient.publish(this.information.topic, 'colorTem', {
			color: data,
			colorTemInKelvin: temp,
		});
	}

	/**
	 * Function to convert RGB values to a format which can be sent to Govee (explanation as a comment inside the function)
	 * @param param0 r, g and b values as an object
	 * @returns r, g and b values as an object
	 */
	getRGBPack({ r, g, b }) {
		/*
		Why does this function exist?
		=============================

		While doing some early tests, I noticed that one of my lights wasn't changing its color.
		I tried to change the json keys from "red", "green", and "blue" to "r", "g" and "b" and it worked.
		Then I tried to use the new keys with the other light that used "red", "green" and "blue": that didn't work.

		This means that different Govee devices use different RGB keys inside the json object for whatever reason.
		The device SKUs are stored inside the `settings.ts` file in a variable called `SINGLE_LETTER_COLOR_SKU`.
		There's only one device yet (the one I have ;)) but if there are more feel free to add them ^^
		*/
		var data;
		if (SINGLE_LETTER_COLOR_SKU.includes(this.information.sku)) {
			// This device uses different key names, ffs
			data = {
				r: r,
				g: g,
				b: b,
			};
		} else {
			data = {
				red: r,
				green: g,
				blue: b,
			};
		}

		return data;
	}

	/**
	 * fetches the current status from Govee (turns off the lights, might need to fix that later)
	 */
	async fetchStatus(): Promise<void> {
		this.mqttClient.publish(this.information.topic, 'turn', {});
	}

	/**
	 * Processes new data from the MQTT client
	 * @param state state object from the MQTT client
	 */
	updateState(state): void {
		// updates the `state` variable inside the `information` object
		this.information.state = new GoveeDeviceState(state);

		// Updates several Homebridge device states
		this.service.updateCharacteristic(
			this.platform.Characteristic.On,
			this.information.state.on == 1 ? true : false
		);
		this.service.updateCharacteristic(
			this.platform.Characteristic.Brightness,
			(Number(this.information.state.brightness) / 255) * 100
		);

		const homekitColorTemp =
			(((-this.information.state.colorTemperatureKelvin +
				(2000 + 4000) -
				2000) *
				100) /
				(9000 - 2000) /
				100) *
				(500 - 140) +
			140;
		this.service.updateCharacteristic(
			this.platform.Characteristic.ColorTemperature,
			homekitColorTemp
		);

		const hsv = RGBtoHSV(
			this.information.state.color.r,
			this.information.state.color.g,
			this.information.state.color.b
		);
		this.service.updateCharacteristic(
			this.platform.Characteristic.Hue,
			hsv.h * 360
		);
		this.service.updateCharacteristic(
			this.platform.Characteristic.Saturation,
			hsv.s * 100
		);
	}
}

class GoveePlatformAccessoryInformation {
	id: string;
	sku: string;
	versionHardware: string;
	versionSoftware: string;
	name: string;
	topic: string;
	state?: GoveeDeviceState;

	constructor(json) {
		this.id = json.device;
		this.sku = json.sku;
		this.versionHardware = json.versionHard;
		this.versionSoftware = json.versionSoft;
		this.name = json.deviceName;
		const deviceSettings = JSON.parse(json.deviceExt.deviceSettings);
		this.topic = deviceSettings.topic;
		this.state = undefined;
	}
}

enum GoveeDevicePowerState {
	on = 1,
	off = 0,
}

export class GoveeDeviceState {
	on: number;
	brightness: number;
	colorTemperatureKelvin: number;
	color: GoveeDeviceStateColor;
	hue: number;
	saturation: number;
	mode?: number;
	connected: boolean;

	constructor(json) {
		this.on = json.onOff ?? 0;
		this.brightness = json.brightness ?? 0;
		this.connected = true; // TODO
		this.colorTemperatureKelvin = json.colorTemInKelvin ?? 0;
		this.color = new GoveeDeviceStateColor(json.color ?? { r: 0, g: 0, b: 0 });
		this.mode = json.mode ?? undefined;
		if (this.colorTemperatureKelvin != 0) {
			this.color = new GoveeDeviceStateColor(
				kelvin_to_rgb(this.colorTemperatureKelvin)
			);
		}
	}
}

export class GoveeDeviceStateColor {
	r: number;
	g: number;
	b: number;

	constructor(json) {
		this.r = json.r;
		this.g = json.g;
		this.b = json.b;
	}
}
function kelvin_to_rgb(value): any {
	// Algorithm: https://tannerhelland.com/2012/09/18/convert-temperature-rgb-algorithm-code.html

	const temperature = Math.max(Math.min(value, 9000), 2000) / 100;

	var red = 0;
	var green = 0;
	var blue = 0;

	// RED

	if (temperature <= 66) {
		red = 255;
	} else {
		red = temperature - 60;
		red = 329.698727446 * Math.pow(red, -0.1332047592);
		if (red < 0) red = 0;
		if (red > 255) red = 255;
	}

	// GREEN

	if (temperature <= 66) {
		green = temperature;
		green = 99.4708025861 * Math.log(green) - 161.1195681661;
	} else {
		green = temperature - 60;
		green = 288.1221695283 * Math.pow(green, -0.0755148492);
	}

	if (green < 0) green = 0;
	if (green > 255) green = 255;

	// BLUE

	if (temperature >= 66) {
		blue = 255;
	} else {
		if (temperature <= 19) {
			blue = 0;
		} else {
			blue = temperature - 10;
			blue = 138.5177312231 * Math.log(blue) - 305.0447927307;
			if (blue < 0) blue = 0;
			if (blue > 255) blue = 255;
		}
	}
	return { r: red, g: green, b: blue };
}

function HSVtoRGB(h, s, v) {
	// Credit: https://stackoverflow.com/questions/17242144/javascript-convert-hsb-hsv-color-to-rgb-accurately
	var r, g, b, i, f, p, q, t;
	if (arguments.length === 1) {
		(s = h.s), (v = h.v), (h = h.h);
	}
	i = Math.floor(h * 6);
	f = h * 6 - i;
	p = v * (1 - s);
	q = v * (1 - f * s);
	t = v * (1 - (1 - f) * s);
	switch (i % 6) {
		case 0:
			(r = v), (g = t), (b = p);
			break;
		case 1:
			(r = q), (g = v), (b = p);
			break;
		case 2:
			(r = p), (g = v), (b = t);
			break;
		case 3:
			(r = p), (g = q), (b = v);
			break;
		case 4:
			(r = t), (g = p), (b = v);
			break;
		case 5:
			(r = v), (g = p), (b = q);
			break;
	}
	return {
		r: Math.round(r * 255),
		g: Math.round(g * 255),
		b: Math.round(b * 255),
	};
}

function RGBtoHSV(r, g, b) {
	if (arguments.length === 1) {
		(g = r.g), (b = r.b), (r = r.r);
	}
	var max = Math.max(r, g, b),
		min = Math.min(r, g, b),
		d = max - min,
		h,
		s = max === 0 ? 0 : d / max,
		v = max / 255;

	switch (max) {
		case min:
			h = 0;
			break;
		case r:
			h = g - b + d * (g < b ? 6 : 0);
			h /= 6 * d;
			break;
		case g:
			h = b - r + d * 2;
			h /= 6 * d;
			break;
		case b:
			h = r - g + d * 4;
			h /= 6 * d;
			break;
	}

	return {
		h: h,
		s: s,
		v: v,
	};
}
