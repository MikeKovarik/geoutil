import {EventEmitter} from 'mapbox-toolbox'
// TODO: extend emitter
// TODO: fire events when stopped
// TODO: fire events when moving again after stopping

var geo = navigator.geolocation

class Geolocation extends EventEmitter {

	// promise
	ready = undefined
	// current precision
	precision = undefined
	// 
	distanceBetween = undefined
	// is currently watching
	watching = false

	allowed = false

	constructor() {
		super()
		this.ready = this.getStatus()
	}

	// get current position
	get() {
		return new Promise(resolve => {
			return geo.getCurrentPosition(pos => {
				resolve(this._parsePos(pos))
			})
		})
	}

	_parsePos(pos) {
		return {
			timestamp: pos.timestamp,
			accuracy: pos.coords.accuracy,
			coords: [
				pos.coords.longitude,
				pos.coords.latitude,
			]
		}
	}

	//options.maxTime // when to end, millis from now
	//options.maxMeasures // how many measuremens to take
	start(options = {}) {
		this.watching = true
		options.enableHighAccuracy = true
		//timeout.timeout = 5000
		//timeout.maximumAge = 0
		let onSuccess = pos => this.emit('position', this._parsePos(pos))
		let onError = err => console.warn('geoloc watch error', err)
		this.id = navigator.geolocation.watchPosition(onSuccess, onError, options)
	}

	stop() {
		if (this.id === undefined) return
		navigator.geolocation.clearWatch(this.id)
		this.id = undefined
		this.watching = false
	}

	async getStatus() {
		this.status = await navigator.permissions.query({name:'geolocation'})
		this.status.onchange = this.onChange
		this.allowed = this.status.state === 'granted'
		console.log('GPS', this.allowed)
	}

	onChange = e => {
		this.allowed = this.status.state === 'granted'
		console.log('geolocation permission state has changed to ', this.status.state)
	}

	async hasPermission() {

	}

}

export default new Geolocation