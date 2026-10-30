import {test} from 'node:test';import assert from 'node:assert/strict';
import {KAABA,assessLocation,bearing,difference,trustworthyHeading,validCoordinates} from '../qibla-math.mjs';
test('qibla bearings agree with known great-circle directions',()=>{
 for(const [lat,lon,expected] of [[24.7136,46.6753,244],[51.5074,-.1278,119],[40.7128,-74.006,58.5],[17.2478,43.1035,324]])assert(Math.abs(bearing(lat,lon)-expected)<2,`${lat},${lon}`);
 assert.equal(validCoordinates(NaN,43),false);assert.throws(()=>bearing(95,43));
});
test('reported coarse locations in Faifa remain usable when their sampled qibla direction is stable',()=>{
 const precise=assessLocation(17.2478,43.1035,10);
 assert.equal(precise.usable,true);assert.equal(precise.approximate,false);assert.equal(precise.reason,null);
 assert(precise.uncertaintyDegrees<1);
 assert.equal(assessLocation(17.2478,43.1035,0).usable,true);
 for(const accuracy of [1500,5000,25000]){
  const quality=assessLocation(17.2478,43.1035,accuracy);
  assert.equal(quality.usable,true,`${accuracy}m`);assert.equal(quality.approximate,true);
  assert.equal(quality.reason,null);assert(quality.uncertaintyDegrees>0&&quality.uncertaintyDegrees<10);
 }
});
test('coarse worldwide positions use directional sensitivity rather than a fixed accuracy cap',()=>{
 for(const [lat,lon] of [[40.7128,-74.006],[51.5074,-.1278],[-33.8688,151.2093]]){
  for(const accuracy of [5000,100000]){
   const quality=assessLocation(lat,lon,accuracy);
   assert.equal(quality.usable,true,`${lat},${lon} ±${accuracy}m`);
   assert.equal(quality.approximate,true);assert.equal(quality.reason,null);
  }
 }
});
test('locations close to Kaaba and circles with unstable qibla bearings are rejected',()=>{
 assert.equal(assessLocation(KAABA.latitude,KAABA.longitude,10).reason,'near-kaaba');
 const surrounding=assessLocation(21.3891,39.8579,10000);
 assert.equal(surrounding.usable,false);assert.equal(surrounding.reason,'inaccurate');
 assert.equal(surrounding.uncertaintyDegrees,null);
 const unstable=assessLocation(21.6,39.826206,5000);
 assert.equal(unstable.usable,false);assert.equal(unstable.reason,'inaccurate');
 assert(unstable.uncertaintyDegrees>10);
});
test('location assessment rejects invalid inputs and uncertainty around poles or the antipode',()=>{
 for(const [lat,lon,accuracy] of [[NaN,43,10],[91,0,10],[0,-181,10],[17,43,-1],[17,43,Infinity],[17,43,'5000']]){
  const quality=assessLocation(lat,lon,accuracy);
  assert.equal(quality.usable,false);assert.equal(quality.reason,'invalid');
 }
 for(const [lat,lon,accuracy] of [[90,0,0],[89.99,0,2000],[-89.99,0,2000],[-KAABA.latitude,KAABA.longitude-180,0],[-KAABA.latitude+.01,KAABA.longitude-180,2000]]){
  const quality=assessLocation(lat,lon,accuracy);
  assert.equal(quality.usable,false,`${lat},${lon} ±${accuracy}m`);assert.equal(quality.reason,'inaccurate');
 }
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
