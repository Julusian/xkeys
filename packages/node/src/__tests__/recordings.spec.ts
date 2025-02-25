import * as fs from 'fs'
import * as HID from 'node-hid'
import { Product, PRODUCTS, describeEvent } from '@xkeys-lib/core'
import * as HIDMock from '../__mocks__/node-hid'
import { setupXkeysPanel, XKeys, XKeysEvents } from '../'
import { getSentData, handleXkeysMessages, resetSentData } from './lib'

describe('Recorded tests', () => {
	async function setupTestPanel(params: { productId: number }): Promise<XKeys> {
		const hidDevice = {
			vendorId: XKeys.vendorId,
			productId: params.productId,
			interface: 0,
			path: 'mockPath',
		} as HID.Device

		HIDMock.setMockWriteHandler(handleXkeysMessages)

		const myXkeysPanel = await setupXkeysPanel(hidDevice)

		return myXkeysPanel
	}
	beforeAll(() => {
		expect(HIDMock.setMockWriteHandler).toBeTruthy()
		// @ts-expect-error mock
		expect(HID.setMockWriteHandler).toBeTruthy()
	})
	beforeEach(() => {})

	const dirPath = './src/__tests__/recordings/'

	const recordings: { filePath: string; recording: any }[] = []
	fs.readdirSync(dirPath).forEach((file) => {
		if (!file.match(/json$/)) return // only use json files
		const recording: any = JSON.parse(fs.readFileSync(dirPath + file, 'utf-8'))
		recordings.push({
			filePath: file,
			recording: recording,
		})
	})

	recordings.forEach(({ filePath, recording }) => {
		test(`Recording "${filePath}"`, async () => {
			const xkeysDevice = await setupTestPanel({
				productId: recording.device.productId,
			})
			let lastDescription: string[] = []
			let lastData: { event: string; args: any[] }[] = []

			const handleEvent = (event: keyof XKeysEvents) => {
				xkeysDevice.on(event, (...args: any[]) => {
					lastDescription.push(describeEvent(event, args))
					lastData.push({ event, args })
				})
			}
			handleEvent('down')
			handleEvent('up')
			handleEvent('jog')
			handleEvent('shuttle')
			handleEvent('joystick')
			handleEvent('tbar')
			handleEvent('disconnected')

			// Go through all recorded events:
			// (ie mock that data comes from the device, and check that the right events are emitted from the class)
			expect(recording.events.length).toBeGreaterThanOrEqual(1)
			for (const event of recording.events) {
				try {
					expect(event.data).toHaveLength(1)

					for (const data of event.data) {
						// Mock the device sending data:
						// @ts-expect-error hack
						xkeysDevice.device.emit('data', Buffer.from(data, 'hex'))
					}
					if (event.description) {
						expect(lastDescription).toEqual([event.description])
						expect(lastData).toHaveLength(1)
						const eventType = lastData[0].event
						if (['down', 'up'].includes(eventType)) {
							const index = lastData[0].args[0]
							expect(index).toBeWithinRange(0, 999)

							const metadata = lastData[0].args[1]
							expect(metadata).toBeObject()
							expect(metadata.row).toBeWithinRange(0, 99)
							expect(metadata.col).toBeWithinRange(0, 99)
							if (xkeysDevice.info.emitsTimestamp) {
								expect(metadata.timestamp).toBeWithinRange(1, Number.POSITIVE_INFINITY)
							} else {
								expect(metadata.timestamp).toBe(undefined)
							}
						} else if (['jog', 'shuttle', 'joystick', 'tbar'].includes(eventType)) {
							const index = lastData[0].args[0]
							expect(index).toBeWithinRange(0, 999)

							// const value = lastData[0].args[1]

							const metadata = lastData[0].args[2]
							expect(metadata).toBeObject()

							if (xkeysDevice.info.emitsTimestamp) {
								expect(metadata.timestamp).toBeWithinRange(1, Number.POSITIVE_INFINITY)
							} else {
								expect(metadata.timestamp).toBe(undefined)
							}
						} else {
							throw new Error(`Unsupported event: "${eventType}" (update tests)`)
						}
					} else {
						expect(lastDescription).toEqual([])
						expect(lastData).toHaveLength(0)
					}

					lastDescription = []
					lastData = []
				} catch (err) {
					console.log(event.description)
					throw err
				}
			}

			// Go through all recorded actions:
			// (ie trigger a method on the class, verify that the data sent to the device is correct)
			expect(recording.actions.length).toBeGreaterThanOrEqual(1)
			resetSentData()
			for (const action of recording.actions) {
				try {
					// @ts-expect-error hack
					expect(xkeysDevice[action.method]).toBeTruthy()
					expect(action.anomaly).toBeFalsy()

					// @ts-expect-error hack
					xkeysDevice[action.method](...action.arguments)

					expect(getSentData()).toEqual(action.sentData)
					resetSentData()
				} catch (err) {
					console.log('action', action)
					throw err
				}
			}
		})
	})

	test('Product coverage', () => {
		const products: { [name: string]: Product } = {}
		for (const [key, product] of Object.entries(PRODUCTS)) {
			products[key] = product
		}

		recordings.forEach(({ recording }) => {
			// Find and remove matched product:
			for (const [key, product] of Object.entries(products)) {
				let found = false
				for (const hidDevice of product.hidDevices) {
					if (hidDevice[0] === recording.info.productId && hidDevice[1] === recording.info.interface) {
						found = true
					}
				}
				if (found) {
					delete products[key]
					break
				}
			}
		})

		console.log(
			`Note: Products not yet covered by tests: \n${Object.values(products)
				.map((p) => `* ${p.name}`)
				.join('\n')}`
		)

		// This number should be decreased as more recordings are added
		expect(Object.values(products).length).toBeLessThanOrEqual(8)
	})
})
