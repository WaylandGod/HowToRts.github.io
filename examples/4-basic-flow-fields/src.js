//How big the grid is in pixels
var gridWidthPx = 800, gridHeightPx = 448;
var gridPx = 32;

//Grid size in actual units
var gridWidth = gridWidthPx / gridPx;
var gridHeight = gridHeightPx / gridPx;

//Storage for the current agents and obstacles
var agents = new Array();
var obstacles = new Array();

//Defines an agent that moves
Agent = function (pos) {
	this.position = pos;
	this.rotation = 0;

	this.velocity = Vector2.zero;

	this.maxForce = 20; //rate of acceleration
	this.maxSpeed = 4; //grid squares / second

	this.radius = 0.4;
	this.minSeparation = 0.8; // We'll move away from anyone nearer than this

	this.maxCohesion = 3.5; //We'll move closer to anyone within this bound
};

var destination = new Vector2(gridWidth - 2, gridHeight / 2); //middle right

//Called to start the game
function startGame() {
	for (var y = 1; y < gridHeight - 1; y++) {
		agents.push(new Agent(new Vector2(0, y)));
	}
	for (var i = 0; i < 30; i++) {
		obstacles.push(new Vector2(1 + Math.floor(Math.random() * (gridWidth - 2)), Math.floor(Math.random() * (gridHeight - 1))));
	}

	generateDijkstraGrid();
	generateFlowField();

	stage.addEventListener('stagemouseup', function (ev) {
		destination.x = ev.stageX / gridPx - 0.5;
		destination.y = ev.stageY / gridPx - 0.5;
	});
}

function round(val) {
	return val.toFixed(1);
}

//called periodically to update the game
//dt is the change of time since the last update (in seconds)
function gameTick(dt) {
	var i, agent;

	//Calculate steering and flocking forces for all agents
	for (i = agents.length - 1; i >= 0; i--) {
		agent = agents[i];

		//Work out our behaviours
		agent.forceToApply = steeringBehaviourFlowField(agent, destination);;
	}

	//Move agents based on forces being applied (aka physics)
	for (i = agents.length - 1; i >= 0; i--) {
		agent = agents[i];

		//Apply the force
		agent.velocity = agent.velocity.plus(agent.forceToApply.mul(dt));

		//Cap speed as required
		var speed = agent.velocity.length();
		if (speed > agent.maxSpeed) {
			agent.velocity = agent.velocity.mul(agent.maxSpeed / speed);
		}

		//Calculate our new movement angle
		agent.rotation = agent.velocity.angle();

		//Move a bit
		agent.position = agent.position.plus(agent.velocity.mul(dt));
	}
}

function steeringBehaviourFlowField(agent) {

	//Work out the force to apply to us based on the flow field grid squares we are on.
	//we apply bilinear interpolation on the 4 grid squares nearest to us to work out our force.
	// http://en.wikipedia.org/wiki/Bilinear_interpolation#Nonlinear

	var floor = agent.position.floor(); //Top left Coordinate of the 4

	//The 4 weights we'll interpolate, see http://en.wikipedia.org/wiki/File:Bilininterp.png for the coordinates
	var f00 = flowField[floor.x][floor.y];
	var f01 = flowField[floor.x][floor.y + 1];
	var f10 = flowField[floor.x + 1][floor.y];
	var f11 = flowField[floor.x + 1][floor.y + 1];

	//Do the x interpolations
	var xWeight = agent.position.x - floor.x;

	var top = f00.mul(1 - xWeight).plus(f10.mul(xWeight));
	var bottom = f01.mul(1 - xWeight).plus(f11.mul(xWeight));

	//Do the y interpolation
	var yWeight = agent.position.y - floor.y;

	//This is now the direction we want to be travelling in (needs to be normalized)
	var direction = top.mul(1 - yWeight).plus(bottom.mul(yWeight)).normalize();


	//If we are centered on a grid square with no vector this will happen
	if (isNaN(direction.length())) {
		return Vector2.zero;
	}

	//Multiply our direction by speed for our desired speed
	var desiredVelocity = direction.mul(agent.maxSpeed);

	//The velocity change we want
	var velocityChange = desiredVelocity.minus(agent.velocity);
	//Convert to a force
	return velocityChange.mul(agent.maxForce / agent.maxSpeed);
}

var dijkstraGrid;
var flowField;

function generateDijkstraGrid() {
	//Generate an empty grid, set all places as weight null, which will stand for unvisited
	dijkstraGrid = new Array(gridWidth);
	for (var x = 0; x < gridWidth; x++) {
		var arr = new Array(gridHeight);
		for (var y = 0; y < gridHeight; y++) {
			arr[y] = null;
		}
		dijkstraGrid[x] = arr;
	}

	//Set all places where obstacles are as being weight MAXINT, which will stand for not able to go here
	for (var i = 0; i < obstacles.length; i++) {
		var t = obstacles[i];

		dijkstraGrid[t.x][t.y] = Number.MAX_VALUE;
	}

	//flood fill out from the end point
	var pathEnd = destination.round();
	pathEnd.distance = 0;
	dijkstraGrid[pathEnd.x][pathEnd.y] = 0;

	var toVisit = [pathEnd];

	//for each node we need to visit, starting with the pathEnd
	for (i = 0; i < toVisit.length; i++) {
		var neighbours = straightNeighboursOf(toVisit[i]);

		//for each neighbour of this node (only straight line neighbours, not diagonals)
		for (var j = 0; j < neighbours.length; j++) {
			var n = neighbours[j];

			//We will only ever visit every node once as we are always visiting nodes in the most efficient order
			if (dijkstraGrid[n.x][n.y] === null) {
				n.distance = toVisit[i].distance + 1;
				dijkstraGrid[n.x][n.y] = n.distance;
				toVisit.push(n);
			}
		}
	}
}


function generateFlowField() {
	var x, y;

	//Generate an empty grid, set all places as Vector2.zero, which will stand for no good direction
	flowField = new Array(gridWidth);
	for (x = 0; x < gridWidth; x++) {
		var arr = new Array(gridHeight);
		for (y = 0; y < gridHeight; y++) {
			arr[y] = Vector2.zero;
		}
		flowField[x] = arr;
	}

	//for each grid square
	for (x = 0; x < gridWidth; x++) {
		for (y = 0; y < gridHeight; y++) {

			//Obstacles have no flow value
			if (dijkstraGrid[x][y] == Number.MAX_VALUE) {
				continue;
			}

			var pos = new Vector2(x, y);
			var neighbours = allNeighboursOf(pos);

			//Go through all neighbours and find the one with the lowest distance
			var min = null;
			var minDist = 0;
			for (var i = 0; i < neighbours.length; i++) {
				var n = neighbours[i];
				var dist = dijkstraGrid[n.x][n.y] - dijkstraGrid[pos.x][pos.y];

				if (dist < minDist) {
					min = n;
					minDist = dist;
				}
			}

			//If we found a valid neighbour, point in its direction
			if (min != null) {
				flowField[x][y] = min.minus(pos).normalize();
			}
		}
	}
}

function straightNeighboursOf(v) {
	var res = [];
	if (v.x > 0) {
		res.push(new Vector2(v.x - 1, v.y));
	}
	if (v.y > 0) {
		res.push(new Vector2(v.x, v.y - 1));
	}

	if (v.x < gridWidth - 1) {
		res.push(new Vector2(v.x + 1, v.y));
	}
	if (v.y < gridHeight - 1) {
		res.push(new Vector2(v.x, v.y + 1));
	}

	return res;
}

function allNeighboursOf(v) {
	var res = [];

	for (var dx = -1; dx <= 1; dx++) {
		for (var dy = -1; dy <= 1; dy++) {
			var x = v.x + dx;
			var y = v.y + dy;

			//All neighbours on the grid that aren't ourself
			if (x >= 0 && y >= 0 && x < gridWidth && y < gridHeight && !(dx == 0 && dy == 0)) {
				res.push(new Vector2(x, y));
			}
		}
	}

	return res;
}