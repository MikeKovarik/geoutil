// speed
// real square
// line angle

// 6 decimals goes to 24 bits
// but 5 decimals means 2 byte less on each coord
const COORD_PRECISION = 5
//const COORD_PRECISION = 6

function roundFloat(num) {
	return Number((num).toFixed(COORD_PRECISION))
}

// accepts single coordinate array
// [0,0]
function roundCoord(arr) {
	return arr.map(roundFloat)
}

// accepts array of coords array
// [ [0,0], [1,1], [2,2] ]
function roundCoords(arr) {
	return arr.map(roundCoord)
}

export function isGeoJson(arg) {
	return arg
		&& arg.type
		&& (arg.geometry || arg.features)
}

// round
export function round(arg) {
	if (typeof arg === 'number') {
		return roundFloat(arg)
	} else if (!Array.isArray(arg)) {
		// geojson linestring
		arg.geometry.coordinates = roundCoords(arg.geometry.coordinates)
	} else if (Array.isArray(arg[0])) {
		return roundCoords(arg)
	} else {
		return roundCoord(arg)
	}
	return arg
}

// round and remove duplicates
export function clean(arg) {
	// round all coords to have 5 decimal digits (the coord takes 4 bytes)
	let rounded = round(arg)
	// remove duplicates
	// return the same format as input
	if (isGeoJson(arg)) {
		return turf.cleanCoords(rounded)
	} else {
		return turf.cleanCoords(turf.lineString(rounded)).geometry.coordinates
	}
}
/*
// round, remove duplicates and simplify
export function simplify(line) {
	// TODO: simplify with the other library
	var simplified = turf.simplify(line, {tolerance: 0.001})
	return round(simplified)
}
*/
// calculate average angle of the line
export function angle(line, precision = 10) {
	var length = line.properties.length || turf.length(line)
	var step = length / precision
	var coords = line.geometry.coordinates
	var firstCoord = coords[0]
	var lastCoord = coords[coords.length - 1]
	var prevCoord = firstCoord
	var angle = 0
	for (var i = 1; i < precision; i++) {
		let nextPoint = turf.along(line, step * i)
		angle += turf.bearing(prevCoord, nextPoint)
		prevCoord = nextPoint
	}
	angle += turf.bearing(prevCoord, lastCoord)
	return angle / precision
}

// calculate square bounding box around existing bbox
export function square(bbox) {
	var [west, south, east, north] = bbox

	var width  = turf.distance([west, north], [east, north])
	var height = turf.distance([west, north], [west, south])

	var center = turf.midpoint([west, north], [east, south])

	if (width > height) {
		var top    = turf.destination(center, width / 2, 0)
		var bottom = turf.destination(center, width / 2, 180)
		north = top.geometry.coordinates[1]
		south = bottom.geometry.coordinates[1]
	} else {
		var left  = turf.destination(center, height / 2, -90)
		var right = turf.destination(center, height / 2, 90)
		west = left.geometry.coordinates[0]
		east = right.geometry.coordinates[0]
	}

	return [west, south, east, north]
}

export function calculateLineBasics(line) {
	var props = line.properties
	var coords = turf.getCoords(line.geometry)
	// basic info
	props.length    = turf.length(line)
	props.precision = (coords.length - 2) / props.length
	props.angle     = angle(line)
	// basic descriptive coords
	props.start     = cloneCoord(coords[0])
	props.end       = cloneCoord(coords[coords.length - 1])
	props.centroid  = roundCoord(turf.getCoord(turf.centroid(line)))
	props.middle    = roundCoord(turf.getCoord(turf.along(line, props.length / 2)))
	return
	// bbox
	props.square = square(line)
	props.bbox   = turf.bbox(line)
}

// it is necessary to clone existing coords and create new array to prevent
// circular references and accidentaly modifying the original
function cloneCoord([lon, lat]) {
	return [lon, lat]
}

export function getLineCoordDesc(line) {
	return [
		line.properties.start,
		line.properties.end,
		line.properties.centroid,
		line.properties.middle,
	]
}

function calculateDistance(coordsA, coordsB) {
	var distances = []
	for (let coordA of coordsA) {
		for (let coordB of coordsB) {
			distances.push(turf.distance(coordA, coordB))
		}
	}
	return distances
}

let descending = (a, b) => b - a

////////////////////////////////////////////////////////////////////
// ONE V ONE / ONE V MANY ANALYSIS /////////////////////////////////
////////////////////////////////////////////////////////////////////

export function detectDuplicateLines(lineA, lineB) {
	var lengthA = lineA.properties.length
	var lengthB = lineB.properties.length
	if (lengthA > lengthB) {
		var [lineA, lineB] = [lineA, lineB]
		var [lengthA, lengthB] = [lengthA, lengthB]
	} else {
		var [lineA, lineB] = [lineB, lineA]
		var [lengthA, lengthB] = [lengthB, lengthA]
	}

	var step = 0.2
	var pointCount = Math.floor(lengthB / step)
	var distances = Array(pointCount).fill(0).map((n, i) => (i + 1) * step)
	var points = distances.map(distance => turf.along(lineB, distance))
	points.unshift(turf.getCoords(lineB).first)
	points.push(turf.getCoords(lineB).last)

	var intersectPoints = turf.lineIntersect(lineA, lineB)
	var intersects = intersectPoints.features.length

	var diffs = points.map(point => turf.pointToLineDistance(point, lineA))
	var median = diffs.median()
	//var mean = diffs.mean()

	// points per kilometer
	var coordsPerKmA = lineA.geometry.coordinates.length / lengthA
	var coordsPerKmB = lineB.geometry.coordinates.length / lengthB

	var fuzzy = 0.15 + (intersects * 0.01)

	fuzzy += coordsPerKmA > 2 ? -0.015 : 0.05
	fuzzy += coordsPerKmB > 2 ? -0.015 : 0.05

	//console.log('fuzzy', fuzzy)
	//console.log('median', median)
	//console.log('mean', mean)
	//console.log('intersects', intersects)

	return median < fuzzy
}

// returns candidates that are closest to lineA
export function findClosestLine(lineA, collection) {
	var sourcePoints = getLineCoordDesc(lineA)
	var sourceLength = lineA.properties.length
	// todo: ignore self (by id)
	return (collection.features || collection)
		.filter(lineB => lineB.properties.id !== lineA.properties.id)
		.filter(lineB => {
			var otherPoints = getLineCoordDesc(lineB)
			var distances = calculateDistance(sourcePoints, otherPoints)
			let otherLength = lineB.properties.length
			var closestDistance = distances.sort(descending).pop()
			var maxAllowedDistance = Math.max(sourceLength, otherLength) / 3
			return closestDistance < maxAllowedDistance
		})
}

////////////////////////////////////////////////////////////////////
// RECONSTRUCT FROM RANDOM COORDS //////////////////////////////////
////////////////////////////////////////////////////////////////////

// needed for turf
// warning: simple & naive - expects Array<Coord>, Array<Point>, FeatureCollection<Point>
function getCollection(arg) {
	if (!Array.isArray(arg))
		return arg
	else if (Array.isArray(arg[0]))
		return turf.points(arg)
	else
		return turf.featureCollection(arg)
}

// needed because of turf
// warning: simple & naive - expects Array<Coord>, Array<Point>, FeatureCollection<Point>
function getCoords(arg) {
	if (!Array.isArray(arg))
		return arg.features.map(point => point.geometry.coordinates)
	else if (Array.isArray(arg[0]))
		return arg
	else
		return arg.map(point => point.geometry.coordinates)
}

export function furthestFromCenter(pointsOrCoords) {
	var center = turf.center(getCollection(pointsOrCoords))
	var coords = getCoords(pointsOrCoords)
	return furuthest(center, coords)
}

export function furuthest(target, coords) {
	var distances = coords.map(point => turf.distance(target, point))
	var max = Math.max(...distances)
	var index = distances.indexOf(max)
	return coords[index]
}

export function nearest(target, coords) {
	var distances = coords.map(point => turf.distance(target, point))
	var max = Math.min(...distances)
	var index = distances.indexOf(max)
	return coords[index]
}

export function orderedLineFromRandomCoords(coords, start) {
	// clone
	coords = coords.slice(0)
	if (typeof start === 'number')
		var current = coords[start]
	else if (start !== undefined)
		var current = start
	else
		var current = furthestFromCenter(coords)
	var ordered = [current]
	removeArrayItem(coords, current)
	while (coords.length) {
		current = nearest(current, coords)
		ordered.push(current)
		removeArrayItem(coords, current)
	}
	return clean(ordered)
}

function removeArrayItem(array, item) {
	var index = array.indexOf(item)
	if (index !== -1)
		array.splice(index, 1)
}
