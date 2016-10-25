// ==UserScript==
// @name         Just Eat hygiene Check
// @namespace    https://github.com/binarykitten/JustEatHealthCheck
// @version      2.0.4
// @updateURL    https://raw.githubusercontent.com/binarykitten/JustEatHealthCheck/master/JEHealthCheck.user.js
// @supportURL   https://github.com/BinaryKitten/JustEatHealthCheck/issues
// @description  Check the ratings.food.gov for restaurants on just eat and hungry house
// @author       Kathryn Reeve (Previously Lisa Croxford)
// @require      https://cdnjs.cloudflare.com/ajax/libs/jquery/3.1.1/jquery.js
// @require      https://cdnjs.cloudflare.com/ajax/libs/async/2.0.1/async.min.js
// @require      https://cdnjs.cloudflare.com/ajax/libs/datejs/1.0/date.min.js
// @match        http://www.just-eat.co.uk/*
// @match        https://www.just-eat.co.uk/*
// @match        http://hungryhouse.co.uk/*
// @match        https://hungryhouse.co.uk/*
// @grant        GM_xmlhttpRequest
// ==/UserScript==


var DATA_STORE_VERSION = 2;
var hygiene_debug = false;

function normalizeBuisnessName(name) {
    name = name.toLowerCase();
    name = name.replace('&', 'and');
    name = name.replace(' restaurant', '');

    return name;
}

function normalizeAddress(address) {

    address = address.trim().replace('\n', '').replace('\n', ', ').split(', ').map(function (line) {
        return line.trim();
    });

    var street = address[0].replace('\'', '');
    var postCode = address[address.length - 1].trim().replace(/ \(.+\)/g, '');

    if (address.length == 3) {
        return [street, address[1], postCode];
    }

    if (address.length == 4) {
        return [street, address[2], postCode];
    }

    hygiene_debug && console.log('failed to normalize address', address);
}

function checkName(establismentData, jeName) {

    var govName = normalizeBuisnessName(establismentData.BusinessName);
    jeName = normalizeBuisnessName(jeName);

    if (govName === jeName) {
        return true;
    }

    if (govName.indexOf(jeName) !== -1) {
        return true;
    }


    if (jeName.indexOf(govName) !== -1) {
        return true;
    }

    hygiene_debug && console.log('Rejected match:', govName, 'not match', jeName);
    return false;
}

function callApi(method, args, done) {

    var qs = [];
    for (var k in args) {
        if (args.hasOwnProperty(k)) {
            qs.push(k + '=' + args[k]);
        }
    }

    GM_xmlhttpRequest({
        method: "GET",
        url: 'http://api.ratings.food.gov.uk/' + method + '?' + qs.join('&'),
        headers: {
            'x-api-version': 2,
            accept: 'application/json'
        },
        onload: function (response) {
            done(null, JSON.parse(response.responseText));
        }
    });
}

function apiToResult(e) {
    return {
        rating: e.RatingValue,
        image: e.RatingKey + '.JPG',
        name: e.BuisnessName,
        address: [
            e.AddressLine2,
            e.AddressLine3,
            e.PostCode
        ],
        link: 'http://ratings.food.gov.uk/business/en-GB/' + e.FHRSID + '/' + e.BusinessName,
        lastcheck: new Date(e.RatingDate)
    };
}

function parseResult(name, address, data, done) {
    var i, e, establishments = data.establishments;

    if (establishments.length == 1) {
        return done(null, apiToResult(establishments[0]));
    }

    for (i = 0; i < establishments.length; i++) {
        e = establishments[i];

        if (checkName(e, name)) {
            hygiene_debug && console.log('Matched', name, 'as', e.BusinessName);
            return done(null, apiToResult(e));
        }
    }

    hygiene_debug && console.log('Could not match', name, 'at', address);
    hygiene_debug && console.log('Possibles', data.establishments);

    //Fallthrough
    done(null, null);
}


function getValidCacheItem(id) {
    var result = localStorage.getItem(id);
    if (result && result !== 'undefined') {

        result = JSON.parse(result);

        if (result.version === DATA_STORE_VERSION) {
            return result;
        }
    }

    return null;
}

function lookup(id, name, address, done) {

    var result = getValidCacheItem(id);
    if (result) {
        return done(null, result);
    }

    lookupNoCache(name, address, function (err, result) {

        if (result) {
            result.version = DATA_STORE_VERSION;
            localStorage.setItem(id, JSON.stringify(result));
        }
        done(err, result);
    });
}


function lookupNoCache(name, address, done) {

    hygiene_debug && console.log('Finding rating for ', name);
    
    if (typeof(address) == 'undefined') {
        return done('No address for ' + name);
    }

    var addressQuery = address[0] + ', ' + address[2];
    
    callApi('Establishments', {address: addressQuery}, function (err, data) {

        if (err) {
            return done(err);
        }

        if (data.establishments.length !== 0) {
            return parseResult(name, address, data, done);
        }

        hygiene_debug && console.log('No matches for for ', name, 'at', address, 'expanding search...');

        var streetQuery = address[0].replace(/^([0-9-abcd]+)/, '').substring(1) + ', ' + address[2];

        return callApi('Establishments', {address: streetQuery}, function (err, data) {

            if (err) {
                return done(err);
            }

            if (data.establishments.length !== 0) {
                return parseResult(name, address, data, done);
            }

            hygiene_debug && console.log('Failed to find match for', name, 'querying', streetQuery);
            done(null, null);
        });
    });
}

var SitesCommon = {

    updateBadgeCallback: function (imageSize, ratingEl, done) {

        return function (err, result) {
            hygiene_debug && console.log(result);
            ratingEl.removeClass('hygieneRatingLoading');

            if (err) {
                ratingEl.text('Ooops. something went wrong');
                return done(err);
            }

            if (result === null) {
                ratingEl.addClass('unrated');
                ratingEl.attr('data-value', -1);
                ratingEl.text('Manual search');
                ratingEl.attr('href', 'http://ratings.food.gov.uk/');
            } else {
                ratingEl.attr('data-value', result.rating);
                var span = $('<span>').css('backgroundImage', 'url(http://ratings.food.gov.uk/images/scores/' + imageSize + '/' + result.image + ')');
                if (typeof result.lastcheck === 'string') {
                    result.lastcheck = new Date(result.lastcheck);
                }
                ratingEl.text(result.lastcheck.toString('MMMM dS yyyy'));
                ratingEl.prepend(span);
                ratingEl.attr('href', result.link);
            }

            done();
        };

    }

};


var ajaxLoader = 'data:image/gif;base64,R0lGODlhEAAQAPIAAP///wAAAMLCwkJCQgAAAGJiYoKCgpKSkiH+GkNyZWF0ZWQgd2l0aCBhamF4bG9hZC5pbmZvACH5BAAKAAAAIf8LTkVUU0NBUEUyLjADAQAAACwAAAAAEAAQAAADMwi63P4wyklrE2MIOggZnAdOmGYJRbExwroUmcG2LmDEwnHQLVsYOd2mBzkYDAdKa+dIAAAh+QQACgABACwAAAAAEAAQAAADNAi63P5OjCEgG4QMu7DmikRxQlFUYDEZIGBMRVsaqHwctXXf7WEYB4Ag1xjihkMZsiUkKhIAIfkEAAoAAgAsAAAAABAAEAAAAzYIujIjK8pByJDMlFYvBoVjHA70GU7xSUJhmKtwHPAKzLO9HMaoKwJZ7Rf8AYPDDzKpZBqfvwQAIfkEAAoAAwAsAAAAABAAEAAAAzMIumIlK8oyhpHsnFZfhYumCYUhDAQxRIdhHBGqRoKw0R8DYlJd8z0fMDgsGo/IpHI5TAAAIfkEAAoABAAsAAAAABAAEAAAAzIIunInK0rnZBTwGPNMgQwmdsNgXGJUlIWEuR5oWUIpz8pAEAMe6TwfwyYsGo/IpFKSAAAh+QQACgAFACwAAAAAEAAQAAADMwi6IMKQORfjdOe82p4wGccc4CEuQradylesojEMBgsUc2G7sDX3lQGBMLAJibufbSlKAAAh+QQACgAGACwAAAAAEAAQAAADMgi63P7wCRHZnFVdmgHu2nFwlWCI3WGc3TSWhUFGxTAUkGCbtgENBMJAEJsxgMLWzpEAACH5BAAKAAcALAAAAAAQABAAAAMyCLrc/jDKSatlQtScKdceCAjDII7HcQ4EMTCpyrCuUBjCYRgHVtqlAiB1YhiCnlsRkAAAOwAAAAAAAAAAAA==';

var JustEat = {
    processSearchResult: function (el, done) {

        hygiene_debug && console.log('processSearchResult');
        var $el = $(el),
            address = normalizeAddress($el.find('p.c-restaurant__address').text()),
            name = $el.find('h2[itemprop="name"]').text().trim(),
            id = $el.attr('data-restaurant-id'),
            ratingEl = $('<a class="hygieneRating hygieneRatingLoading"></a>');
        ;

        hygiene_debug && console.log(id, name, address);
        $el.prepend(ratingEl);

        lookup(id, name, address, SitesCommon.updateBadgeCallback('small', ratingEl, done));
    },

    processMenuPage: function (i, el) {

        var address = normalizeAddress($('.restInfoAddress').text());
        var name = $('.restaurant-name').text().trim();
        var id = $('#RestaurantId').val();

        var ratingEl = $('<a class="hygieneRatingBig hygieneRatingLoading"></a>');
        $('#divBasketUpdate').prepend(ratingEl);

        lookup(id, name, address, SitesCommon.updateBadgeCallback('large', ratingEl));
    },

    sort: function () {
        if (window.location.search.indexOf('?so=hygiene') === -1) {
            return;
        }
        var e, i, elementList = [];

        $(".c-restaurantt").each(function (i, e) {
            var $e = $(e),
                hygineScore = $e.find(".hygieneRating").attr('data-value'),
                userScore = $e.find('meta[itemprop=ratingValue]').attr('content'),
                combinedScore = hygineScore * 1000 + userScore;
            elementList.push({rating: combinedScore, element: e, parent: $e.parent()});
            $e.remove();
        });
        elementList.sort(function (a, b) {
            return b.rating - a.rating;
        });
        for (i = 0; i < elementList.length; i++) {
            e = elementList[i];
            e.parent.append(e.element);
        }
    },


    addSortOption: function (i, el) {
        var sortOption = '<li class="hygienerating"><a href="' + window.location.pathname + '?so=hygiene"><span class="o-radio"></span>Hygiene Rating</a></li>';
        var filterList = $('.c-serp-filter__list ul');
        filterList.append(sortOption);
        console.log(window.location);
        if (window.location.href.indexOf('?so=hygiene') !== -1) {
            filterList.find('li.is-selected').removeClass('is-selected').removeAttr('data-ft');
            filterList.find('li.hygienerating').addClass('is-selected').attr('data-ft', 'selectedFilter');
        }
    },

    initialize: function () {
        var css = '';
        css += '.hygieneRatingLoading { background-image: url(' + ajaxLoader + '); backgound-repeat: no-repeat !important }';
        css += '.hygieneRating span { display: block; width: 120px !important; height: 61px; margin-bottom:5px; }';
        css += '.hygieneRating { display: block; position: absolute; bottom: 30px; right: 0; text-align: right; font-weight: bold;}';
        css += 'div.c-restaurant { height: 120px;}';
        css += '.c-restaurant__distance { bottom: 6px; }';

        css += '@media (min-width: 1025px) {';
        css += '.hygieneRating { bottom:10px; }';
        css += '.c-restaurant__details { bottom: 100px; text-align: right;}';
        css += '.c-restaurant .o-tile__details { height: 100%; }';
        css += '}';

        $('head').append('<style>' + css + '</style>');

        this.addSortOption();
        async.eachLimit($('.c-restaurant').get(), 5, this.processSearchResult, this.sort);
        $('.restaurant-info-detail').each(this.processMenuPage);

    }
};

var HungryHouse = {

    processMenuPage: function () {

        var ratingEl = $('<a class="hygieneRatingBig hygieneRatingLoading"></a>');
        $('#shopping-cart-form').prepend(ratingEl);

        var name = $('h1 span').attr('content');
        var address = normalizeAddress($('span.address').text());
        var id = window.location.pathname.substr(1);

        console.log('Name:', name, 'address:', address);

        lookup(id, name, address, SitesCommon.updateBadgeCallback('medium', ratingEl));
    },

    lookupFromId: function (id, done) {

        var result = getValidCacheItem(id);
        if (result) {
            return done(null, result);
        }

        GM_xmlhttpRequest({
            method: "GET",
            url: 'https://hungryhouse.co.uk/' + id,
            onload: function (response) {

                var doc = $(response.responseText);

                var name = doc.find('h1 span').attr('content');
                var address = normalizeAddress(doc.find('span.address span').get().map(function (el) {
                    return $(el).text().trim();
                }).join(', '));

                console.log('Name:', name, 'address:', address);
                done(null, name, address);
            }
        });

    },

    addRatingToSearchResult: function (el, done) {

        var id = el.find('.restPageLink').attr('href').substr(1);

        var ratingEl = $('<a class="hygieneRating hygieneRatingLoading"></a>');
        el.find('.restsRestInfo').append(ratingEl);

        HungryHouse.lookupFromId(id, function (err, name, address) {
            lookup(id, name, address, SitesCommon.updateBadgeCallback('small', ratingEl, done));
        });
    },

    //Hungry house loads stuff with ajax so we have to continuously check
    pollForNewSearchItems: function () {

        var newResults = [];

        $('#searchContainer .restaurantBlock').each(function (i, el) {
            if ($(el).find('.hygieneRating').length === 0) {
                newResults.push($(el));
            }
        });

        if (newResults.length === 0) {
            return;
        }

        console.log('Found ', newResults.length, 'restraunts withour rating');
        async.eachLimit(newResults, 5, HungryHouse.addRatingToSearchResult, window.location.hash === '#hygiene' ? HungryHouse.sortResults : null);
    },

    sortResults: function () {


        $('.restsResNotification').remove();
        var i,e, elementList = [];
        $(".restaurantBlock").each(function (i, e) {
            var hygineScore = parseInt($(e).find(".hygieneRating").attr('data-value'), 0);
            var userScore = parseInt(($(e).find('.restsRating div').css('width') || '0px').replace(/[px\%]+/, ''), 10);
            var combinedScore = hygineScore * 1000 + userScore;
            console.log('Score:', $(e).find('h2').text(), hygineScore, userScore, combinedScore);
            elementList.push({rating: combinedScore, element: e, parent: $(e).parent()});
            $(e).remove();
        });
        elementList.sort(function (a, b) {
            return b.rating - a.rating;
        });
        for (i = 0; i < elementList.length; i++) {
            e = elementList[i];
            e.parent.append(e.element);
        }
    },


    addSortOption: function () {
        var a = $('<a href="' + window.location.href + '#hygiene">Hygiene Rating</a>');
        $('#sort-form').append('   |   ');
        $('#sort-form').append(a);

        if (window.location.hash === '#hygeine') {
            $('#sort-form a').removeClass('active');
            a.addClass('active');
        }

        a.click(function () {
            $('#sort-form a').removeClass('active');
            a.addClass('active');
            HungryHouse.sortResults();
        });


    },

    initialize: function () {
        var css = '';
        css += '.hygieneRatingLoading { background-image: url(' + ajaxLoader + '); }';
        css += '.restsRestStatus { top: -5px !important }';
        css += '.hygieneRating { display: block; position: relative; float: right; width: 120px !important; min-height: 66px !important; background-position: center; background-repeat: no-repeat; right: 0px; top: -10px;}';
        css += '.hygieneRatingBig { display: block; width: 100% !important; min-height: 150px; background-position: center; background-repeat: no-repeat }';

        $('head').append('<style>' + css + '</style>');

        $(this.addSortOption);
        $('#website-restaurant-container').each(this.processMenuPage);
        setInterval(this.pollForNewSearchItems, 500);
    }
};

try {
    switch (window.location.host) {
        case 'www.just-eat.co.uk':
            JustEat.initialize();
            JustEat.sort();
            break;
        case 'hungryhouse.co.uk':
            HungryHouse.initialize();
            break;
    }
} catch (e) {
    console.error(e.message, e.stack);
}
