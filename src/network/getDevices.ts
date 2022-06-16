import axios from 'axios';

/**
 * Fetches all devices associated with the Govee account
 * @param token Govee account token
 * @returns json object with all devices
 */
export default async function getDevices(token: string): Promise<any> {
	try {
		const response = await axios.post(
			`https://app.govee.com/device/rest/devices/v1/list`,
			{},
			{
				headers: {
					Authorization: `Bearer ${token}`,
				},
			}
		);

		return response.data.devices;
	} catch (err) {
		console.log(err);
		return [];
	}
}
