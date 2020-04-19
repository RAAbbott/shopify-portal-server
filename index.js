const express = require('express');
const app = express();
const cors = require('cors');
const port = process.env.PORT || '3060';
const Shopify = require('shopify-api-node');
const shopify  = new Shopify({
    shopName: process.env.SHOP_NAME,
    apiKey: process.env.API_KEY,
    password: process.env.PASSWORD
});
require('dotenv').config();


// Express Methods

const bodyParser = require('body-parser');
const corsOptions = {
    origin: 'http://localhost:3000.com',
    optionsSuccessStatus: 200 // some legacy browsers (IE11, various SmartTVs) choke on 204
  }

app.use(bodyParser.json());
app.use(cors(corsOptions));

app.use(bodyParser.urlencoded({
   extended: true
}));

app.listen(port, () => {
    console.log('Listening on port', port);
})

app.get('/orders', async (req, res) => {
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.json(await formatOrders());
});


// Helper Methods

async function getOrders() {
    return await shopify.order.list().then(orders => orders).catch(err => err);
}

async function formatOrders() {
    const orderList = [];
    const orders = await getOrders();

    orders.forEach(order => {
        const productList = [];
        order.line_items.forEach(product => {
            const variants = product.variant_title.split(' / ');
            console.log(variants);
            productList.push({
                id: product.id,
                orderId: order.id,
                productName: product.title,
                option1: 'Size',
                option2: 'Color',
                variant1: variants.length >= 1 ? variants[0] : '',
                variant2: variants.length >= 2 ? variants[1] : '',
                custom: '-',       
            });
        });
        
        orderList.push({
            id: order.id,
            customerName: `${order.customer.first_name} ${order.customer.last_name}`,
            customerEmail: order.email,
            amount: order.total_price,
            note: order.note,
            products: productList
        })
    });


    return orderList;

}