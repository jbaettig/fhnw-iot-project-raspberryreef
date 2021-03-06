const ThingSpeakRestApi = require('./Gateway/ThingSpeakRestApi');
const TwitterApi = require('./Gateway/TwitterApi');
const TempSensor = require('./Sensors/TempSensor');
const WaterLevelSensor = require('./Sensors/WaterLevelSensor');
const Relay = require('./Actuators/Relay');
const LightManager = require('./Timer/LightManager');

var refillBucketEmpty = false;
var directMessageRecipient = 1125735237009510400;

// APIs
var thingSpeakApi = new ThingSpeakRestApi('https://api.thingspeak.com/update.json', '909274', 'BG3OF4PS64WT3GOB');
var twitterApi = new TwitterApi("https://api.twitter.com/1.1/direct_messages/events/new.json", "TSR8o5gA1X6ZU5MMdgrdNrMvZ", "pHSMbNld16i2yTy3CKkewA6C4cNd4MgyqiLQQhaHSbWWq9W3uI", "1125735237009510400-8QqpyyIXzZ5l5EL3XbFyAD4g8Gr373", "OSMkf9hbVIbNHlkVlNxOKLYh5YWaqaYxmmWmobKbYXNTr");

// 1-Wire temp. sensors
var tempSensor_Ground = new TempSensor('28-031622932eff', 3, 'field1');
var tempSensor_Surface = new TempSensor('28-041621ea95ff', 3, 'field2');

// Water level sensors
var waterLevelSensor_ReefMin = new WaterLevelSensor(17, 'field3');
var waterLevelSensor_ReefMax = new WaterLevelSensor(18, 'field4');
var waterLevelSensor_RefillMin = new WaterLevelSensor(27, 'field5');

// Relais
var ledLamp_Left = new Relay(22, 'field6');
var ledLamp_Right = new Relay(23, 'field7');
var refillPump = new Relay(24, 'field8');

// Timer setup
var initialDate = new Date();
var initialSunrise = new Date(initialDate.getFullYear(), initialDate.getMonth(), initialDate.getDate(), 10, 0, 0);
var initialSunset = new Date(initialDate.getFullYear(), initialDate.getMonth(), initialDate.getDate(), 22, 0, 0);
var ledLightManager = new LightManager(initialSunrise, null, null, initialSunset);

console.info("Starting ThingSpeak update interval.");
thingSpeakApi.startPublishInterval();

console.info("Initialize all ThingSpeak fields.");
sendAllDataToThingSpeak();

console.log("Total time lights on in hours: " + ledLightManager.getTotalOnTime());
lightLoop();
mainLoop();

setInterval(() => lightLoop(), 30000);  // Check the light every 30 seconds
setInterval(() => mainLoop(), 60000);   // Check Reef Water Level every minute. Refill if needed.

function lightLoop() {
    var lightShouldBeOn = ledLightManager.getLightShouldBeOn();
    console.info('Should the lights be on? => ' + lightShouldBeOn);
    var data = "";

    if (lightShouldBeOn && ledLamp_Left.getState() != 1) {
        console.log('Going to turn on the left lamp.');
        ledLamp_Left.setStateActive();
        data += "&" + ledLamp_Left.getThingSpeakField() + "=" + ledLamp_Left.getState();
    } else if (!lightShouldBeOn && ledLamp_Left.getState() != 0) {
        console.log('Going to turn off the left lamp.');
        ledLamp_Left.setStateInactive();
        data += "&" + ledLamp_Left.getThingSpeakField() + "=" + ledLamp_Left.getState();
    }

    if (lightShouldBeOn && ledLamp_Right.getState() != 1) {
        console.log('Going to turn on the right lamp.');
        ledLamp_Right.setStateActive();
        data += "&" + ledLamp_Right.getThingSpeakField() + "=" + ledLamp_Right.getState();
    } else if (!lightShouldBeOn && ledLamp_Right.getState() != 0) {
        console.log('Going to turn the right lamp.');
        ledLamp_Right.setStateInactive();
        data += "&" + ledLamp_Right.getThingSpeakField() + "=" + ledLamp_Right.getState();
    }

    if (data != "") {
        thingSpeakApi.addDataToRequestQueue(data);
    }
}

function mainLoop() {
    sendAllDataToThingSpeak();
    var reefMin = waterLevelSensor_ReefMin.getState();

    if (reefMin === 1) { // minimal water level reached
        console.log('Reef needs to be refilled.');
        var refillMin = waterLevelSensor_RefillMin.getState();

        if (refillMin === 0) { // refill bucket contains water -> start the refill process
            refillBucketEmpty = false;
            console.log('Refill bucket contains water. Start the refill process.');
            var refillInterval = setInterval(function () { startRefillProcess(refillInterval) }, 1000);
        } else { // refill bucket is empty
            if (!refillBucketEmpty) {
                refillBucketEmpty = true;
                console.warn('Refill bucket is empty! Send a tweet to the reef owner!');
                var data = "";
                data += "&" + waterLevelSensor_RefillMin.getThingSpeakField() + "=" + waterLevelSensor_RefillMin.getState();
                thingSpeakApi.addDataToRequestQueue(data);
                twitterApi.sendDirectMessageEmptyBucket(directMessageRecipient)
                    .then(results => { console.log("results", results); })
                    .catch(console.error);
            }
        }
    }
}

function startRefillProcess(refillInterval) {
    var reefMax = waterLevelSensor_ReefMax.getState();
    var refillMin = waterLevelSensor_RefillMin.getState();
    var data = "";

    if (reefMax === 0 && refillMin === 0) { // reef is not full and refill bucket is not empty
        refillBucketEmpty = false;
        if (refillPump.getState() === 0) {
            console.log('Starting the refill process.');
            refillPump.setStateActive();
            data += "&" + refillPump.getThingSpeakField() + "=" + refillPump.getState();
            data += "&" + waterLevelSensor_ReefMin.getThingSpeakField() + "=" + waterLevelSensor_ReefMin.getState();
            data += "&" + waterLevelSensor_ReefMax.getThingSpeakField() + "=" + waterLevelSensor_ReefMax.getState();
            data += "&" + waterLevelSensor_RefillMin.getThingSpeakField() + "=" + waterLevelSensor_RefillMin.getState();
            thingSpeakApi.addDataToRequestQueue(data);
        }
    } else if (reefMax === 0 && refillMin === 1) { // reef is not full but refill bucket is empty
        if (refillPump.getState() === 1) {
            if (!refillBucketEmpty) {
                refillBucketEmpty = true;
                refillPump.setStateInactive();
                data += "&" + refillPump.getThingSpeakField() + "=" + refillPump.getState();
                data += "&" + waterLevelSensor_ReefMin.getThingSpeakField() + "=" + waterLevelSensor_ReefMin.getState();
                data += "&" + waterLevelSensor_ReefMax.getThingSpeakField() + "=" + waterLevelSensor_ReefMax.getState();
                data += "&" + waterLevelSensor_RefillMin.getThingSpeakField() + "=" + waterLevelSensor_RefillMin.getState();
                thingSpeakApi.addDataToRequestQueue(data);
                console.warn('Refill bucket is empty! Send a tweet to the reef owner!');
                twitterApi.sendDirectMessageEmptyBucket(directMessageRecipient)
                    .then(results => { console.log("results", results); })
                    .catch(console.error);
            }
        }
        clearInterval(refillInterval);
    } else { // reef is full
        if (refillPump.getState() === 1) {
            console.log('Reef succsessfully refilled.');
            refillPump.setStateInactive();
            data += "&" + refillPump.getThingSpeakField() + "=" + refillPump.getState();
            data += "&" + waterLevelSensor_ReefMin.getThingSpeakField() + "=" + waterLevelSensor_ReefMin.getState();
            data += "&" + waterLevelSensor_ReefMax.getThingSpeakField() + "=" + waterLevelSensor_ReefMax.getState();
            data += "&" + waterLevelSensor_RefillMin.getThingSpeakField() + "=" + waterLevelSensor_RefillMin.getState();
            thingSpeakApi.addDataToRequestQueue(data);
        }
        clearInterval(refillInterval);
    }
}

function sendAllDataToThingSpeak() {
    console.log("Going to update ThingSpeak fields.")
    var data = "";
    data += "&" + tempSensor_Ground.getThingSpeakField() + "=" + tempSensor_Ground.getTemp();
    data += "&" + tempSensor_Surface.getThingSpeakField() + "=" + tempSensor_Surface.getTemp();
    data += "&" + ledLamp_Left.getThingSpeakField() + "=" + ledLamp_Left.getState();
    data += "&" + ledLamp_Right.getThingSpeakField() + "=" + ledLamp_Right.getState();
    data += "&" + refillPump.getThingSpeakField() + "=" + refillPump.getState();
    data += "&" + waterLevelSensor_ReefMin.getThingSpeakField() + "=" + waterLevelSensor_ReefMin.getState();
    data += "&" + waterLevelSensor_ReefMax.getThingSpeakField() + "=" + waterLevelSensor_ReefMax.getState();
    data += "&" + waterLevelSensor_RefillMin.getThingSpeakField() + "=" + waterLevelSensor_RefillMin.getState();
    thingSpeakApi.addDataToRequestQueue(data);
}