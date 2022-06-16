# homebridge-govee-light

This is a plugin to control Govee lights. ! It's specialized and doesn't use the official Govee API. If you need more support, use [this plugin](https://github.com/bwp91/homebridge-govee)!

But no, for real, I built this because the Govee API doesn't support one of my lights. I'm sharing this here because I didn't find any other solution like this.

## Tested devices

- H6154
- H6159

These are the only two devices I have. Feel free to test any other lights with this plugin.

## Installation

There's no npm package yet, so download the repository and run the following commands on the server where Homebridge is installed.

1. `npm i`
2. `npm run build`
3. `npm link`

After that, restart Homebridge. The plugin should show up.

## Config

When you first start the plugin, it'll probably crash. Add the following entries to the "platform" array in your Homebridge config file:

```
{
    "platform": "GoveeLightPlugin",
    "name": "GoveeLight",
    "email": "[your govee account email address]",
    "password": "[your govee account password]",
    "client": "[random string]"
}
```
