function nextStep(section){
document.querySelector('.'+section).style.display='block';
}

function generateRoomTypes(){

const numRooms=parseInt(document.getElementById("numRooms").value);

let roomTypesDiv=document.getElementById("roomTypes");

roomTypesDiv.innerHTML="";

for(let i=0;i<numRooms;i++){

roomTypesDiv.innerHTML+=`
<div>
<label>Room ${i+1} Type:</label>
<input type="text" class="roomType" required>
</div>`;

}

roomTypesDiv.innerHTML+=
'<button onclick="nextStep(\'generate-section\')">Next ➡️</button>';

document.querySelector('.type-section').style.display='block';

}

function generateLayout(){

const width=parseInt(document.getElementById("width").value);
const height=parseInt(document.getElementById("height").value);

const roomTypes=Array.from(
document.getElementsByClassName("roomType")
).map(input=>input.value);

const numRooms=roomTypes.length;

let floorPlan=document.getElementById("floorPlan");

floorPlan.innerHTML="";

floorPlan.style.width=`${width*20}px`;
floorPlan.style.height=`${height*20}px`;

let colors=[
"#ff5733","#33ff57","#3357ff","#ff33a6",
"#ffdb33","#9933ff","#33ffff","#ff9933"
];

let roomWidth=Math.floor(width/Math.sqrt(numRooms));
let roomHeight=Math.floor(height/Math.sqrt(numRooms));

let xOffset=0;
let yOffset=0;

for(let i=0;i<numRooms;i++){

let div=document.createElement("div");

div.className="room";

div.style.width=`${roomWidth*20}px`;
div.style.height=`${roomHeight*20}px`;

div.style.left=`${xOffset}px`;
div.style.top=`${yOffset}px`;

div.style.background=colors[i%colors.length];

div.innerText=`${roomTypes[i]}\n${roomWidth}m x ${roomHeight}m`;

div.dataset.width=roomWidth;
div.dataset.height=roomHeight;

div.addEventListener("dblclick",()=>modifyRoom(div));

floorPlan.appendChild(div);

xOffset+=roomWidth*20;

if(xOffset+roomWidth*20>width*20){
xOffset=0;
yOffset+=roomHeight*20;
}

}

document.querySelector('.modify-section').style.display='block';

}

function modifyRoom(room){

let newWidth=parseInt(prompt("Enter new width (meters):"));
let newHeight=parseInt(prompt("Enter new height (meters):"));

if(isNaN(newWidth)||isNaN(newHeight)||newWidth<=0||newHeight<=0){
return;
}

room.dataset.width=newWidth;
room.dataset.height=newHeight;

room.style.width=`${newWidth*20}px`;
room.style.height=`${newHeight*20}px`;

room.innerText=
`${room.innerText.split('\n')[0]}\n${newWidth}m x ${newHeight}m`;

adjustRooms();

}

function adjustRooms(){

let rooms=document.querySelectorAll(".room");

let width=parseInt(document.getElementById("width").value)*20;

let xOffset=0;
let yOffset=0;

rooms.forEach(room=>{

room.style.left=`${xOffset}px`;
room.style.top=`${yOffset}px`;

xOffset+=parseInt(room.dataset.width)*20;

if(xOffset>=width){
xOffset=0;
yOffset+=parseInt(room.dataset.height)*20;
}

});

}

function enableModification(){
alert("Double-click any room to modify its size.");
}

function finalizeLayout(){
alert("Final architecture plan is ready!");
}
