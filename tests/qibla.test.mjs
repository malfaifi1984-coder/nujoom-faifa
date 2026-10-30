import {test} from 'node:test';import assert from 'node:assert/strict';
import {bearing,difference,trustworthyHeading,validCoordinates} from '../qibla-math.mjs';
test('qibla bearings agree with known great-circle directions',()=>{
 for(const [lat,lon,expected] of [[24.7136,46.6753,244],[51.5074,-.1278,119],[40.7128,-74.006,58.5],[17.2478,43.1035,324]])assert(Math.abs(bearing(lat,lon)-expected)<2,`${lat},${lon}`);
 assert.equal(validCoordinates(NaN,43),false);assert.throws(()=>bearing(95,43));
});
test('calibrated native WebKit heading remains usable when the phone is tilted',()=>{
 assert.equal(trustworthyHeading({webkitCompassHeading:125,webkitCompassAccuracy:5,beta:70,gamma:50}),125);
 assert.equal(trustworthyHeading({webkitCompassHeading:125,webkitCompassAccuracy:20,beta:70,gamma:50}),125);
 assert.equal(trustworthyHeading({webkitCompassHeading:125,webkitCompassAccuracy:-1,beta:70,gamma:50}),null);
 assert.equal(trustworthyHeading({webkitCompassHeading:125,webkitCompassAccuracy:35,beta:70,gamma:50}),null);
 assert.equal(trustworthyHeading({webkitCompassHeading:125,beta:70,gamma:50}),null);
 assert.equal(trustworthyHeading({webkitCompassHeading:125,webkitCompassAccuracy:5,beta:70,gamma:50},90),null);
 assert.equal(trustworthyHeading({alpha:235,absolute:true,beta:70,gamma:50}),null);
 assert.equal(trustworthyHeading({alpha:235,absolute:true,beta:0,gamma:50}),null);
});
test('relative alpha, poor calibration, raw-alpha tilt and unsupported orientation are rejected',()=>{
 assert.equal(trustworthyHeading({alpha:100,absolute:false}),null);
 assert.equal(trustworthyHeading({alpha:10,absolute:true,beta:0,gamma:0}),350);
 assert.equal(trustworthyHeading({webkitCompassHeading:5,webkitCompassAccuracy:-1}),null);
 assert.equal(trustworthyHeading({webkitCompassHeading:5,webkitCompassAccuracy:35}),null);
 assert.equal(trustworthyHeading({webkitCompassHeading:5,webkitCompassAccuracy:5}),5);
 assert.equal(trustworthyHeading({alpha:0,absolute:true,beta:80}),null);
 assert.equal(trustworthyHeading({alpha:0,absolute:true},90),null);
 assert.equal(difference(5,355),10);assert.equal(difference(355,5),-10);
});
