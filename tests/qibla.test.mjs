import {test} from 'node:test';import assert from 'node:assert/strict';
import {bearing,difference,parseCoordinate,parseCoordinates,trustworthyHeading,validCoordinates} from '../qibla-math.mjs';
test('qibla bearings agree with known great-circle directions',()=>{
 for(const [lat,lon,expected] of [[24.7136,46.6753,244],[51.5074,-.1278,119],[40.7128,-74.006,58.5],[17.2478,43.1035,324]])assert(Math.abs(bearing(lat,lon)-expected)<2,`${lat},${lon}`);
 assert.equal(validCoordinates(NaN,43),false);assert.throws(()=>bearing(95,43));
});
test('manual coordinates accept Arabic decimal input without treating blanks or malformed values as zero',()=>{
 assert.equal(parseCoordinate(' −٣٣٫٨٦٨٨ '),-33.8688);
 assert.equal(parseCoordinate('۱۵۱٫۲۰۹۳'),151.2093);
 assert.deepEqual(parseCoordinates('٤٠٫٧١٢٨','−٧٤٫٠٠٦٠'),{latitude:40.7128,longitude:-74.006});
 assert.deepEqual(parseCoordinates('0','0'),{latitude:0,longitude:0});
 assert.deepEqual(parseCoordinates('-90','180'),{latitude:-90,longitude:180});
 for(const value of ['', ' ', '١٧abc', 'Infinity', '1e2', '17.2.4', '١٬٧٠٠'])assert.equal(parseCoordinate(value),null,value);
 for(const [lat,lon] of [['','0'],['91','0'],['0','-181'],['٤٠','']])assert.equal(parseCoordinates(lat,lon),null);
});
test('relative alpha, poor calibration, tilt and unsupported orientation never become confident compass headings',()=>{
 assert.equal(trustworthyHeading({alpha:100,absolute:false}),null);
 assert.equal(trustworthyHeading({alpha:10,absolute:true,beta:0,gamma:0}),350);
 assert.equal(trustworthyHeading({webkitCompassHeading:5,webkitCompassAccuracy:-1}),null);
 assert.equal(trustworthyHeading({webkitCompassHeading:5,webkitCompassAccuracy:35}),null);
 assert.equal(trustworthyHeading({webkitCompassHeading:5,webkitCompassAccuracy:5}),5);
 assert.equal(trustworthyHeading({alpha:0,absolute:true,beta:80}),null);
 assert.equal(trustworthyHeading({alpha:0,absolute:true},90),null);
 assert.equal(difference(5,355),10);assert.equal(difference(355,5),-10);
});
