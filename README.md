function doGet() {
  return HtmlService.createHtmlOutputFromFile('Index')
      .setTitle('Order & Khata Management')
      .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

// ડેટા સેવ કરવા માટે
function saveOrder(data) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName('Orders');
  sheet.appendRow([data.type, data.company, data.date, data.item, data.qty, data.price, data.qty * data.price, data.status]);
  return "ઓર્ડર સફળતાપૂર્વક સેવ થઈ ગયો છે!";
}

function savePayment(data) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName('Payments');
  sheet.appendRow([data.company, data.date, data.amount]);
  return "પેમેન્ટ સેવ થઈ ગયું છે!";
}

// લેજર અને હિસાબ જોવા માટે
function getPartyLedger(companyName) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var orderSheet = ss.getSheetByName('Orders');
  var paymentSheet = ss.getSheetByName('Payments');
  var partySheet = ss.getSheetByName('Parties');
  
  var orders = orderSheet.getDataRange().getValues();
  var payments = paymentSheet.getDataRange().getValues();
  var parties = partySheet.getDataRange().getValues();
  
  var totalSales = 0, totalBuying = 0, totalPaid = 0, whatsapp = "";
  
  // વોટ્સએપ નંબર મેળવવા
  for(var i=1; i<parties.length; i++) {
    if(parties[i][0] == companyName) { whatsapp = parties[i][1]; break; }
  }
  
  // સેલ્સ અને બાઈંગ ગણવા
  for(var i=1; i<orders.length; i++) {
    if(orders[i][1] == companyName) {
      if(orders[i][0] == "Sales") totalSales += parseFloat(orders[i][6]);
      if(orders[i][0] == "Buying") totalBuying += parseFloat(orders[i][6]);
    }
  }
  
  // પેમેન્ટ ગણવા
  for(var i=1; i<payments.length; i++) {
    if(payments[i][0] == companyName) {
      totalPaid += parseFloat(payments[i][2]);
    }
  }
  
  var pendingSales = totalSales - totalPaid;
  
  return {
    whatsapp: whatsapp,
    totalSales: totalSales,
    totalBuying: totalBuying,
    totalPaid: totalPaid,
    pending: pendingSales
  };
}

// ડ્રોપડાઉન માટે બધી પાર્ટીના નામ લેવા
function getParties() {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Parties');
  var data = sheet.getDataRange().getValues();
  var list = [];
  for(var i=1; i<data.length; i++) { list.push(data[i][0]); }
  return list;
}