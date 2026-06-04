(function () {
    let hospitalData = [];
    let homeMap, fullMap, routeMap;
    let homeMarkers = [];
    let routeMarkers = [];
    let routeLine = null;
    let startLocation = null;
    let endLocation = null;
    let currentFilter = 'all';
    let searchQuery = '';
    let watchId = null;
    let currentRouteType = 'fastest';

    const mapBounds = [[0.465791868258028,101.40559896922721],[0.564320375165608,101.5909158638663]];

    document.addEventListener('DOMContentLoaded', function() {
        if (typeof json_Sebaran_Rumah_Sakit_2 !== 'undefined') {
            hospitalData = json_Sebaran_Rumah_Sakit_2.features.map((feature, index) => ({
                id: index,
                name: feature.properties.Nama_RS || 'Rumah Sakit ' + (index + 1),
                address: feature.properties.Alamat || 'Alamat tidak tersedia',
                lat: feature.geometry.coordinates[1],
                lng: feature.geometry.coordinates[0],
                type: getHospitalType(feature.properties.Nama_RS),
                feature: feature
            }));
        }

        const page = document.body.dataset.page;
        setActiveNav(page);

        if (page === 'home') initHomePage();
        if (page === 'map') initMapPage();
        if (page === 'route') initRoutePage();
    });

    function setActiveNav(page) {
        document.querySelectorAll('.navbar-link').forEach(link => {
            link.classList.toggle('active', link.dataset.page === page);
        });
    }

    function initHomePage() {
        updateStats();
        renderHospitalGrid();
        initializeHomeMap();

        const searchInput = document.getElementById('home-search');
        if (searchInput) {
            searchInput.addEventListener('input', function() {
                searchQuery = this.value.toLowerCase();
                renderHospitalGrid();
            });
        }

        const customSelect = document.querySelector('.custom-select');
        const selectTrigger = document.querySelector('.custom-select-trigger');
        const selectOptions = document.querySelectorAll('.custom-option');

        if (customSelect && selectTrigger && selectOptions.length) {
            selectTrigger.addEventListener('click', function(e) {
                customSelect.classList.toggle('active');
                e.stopPropagation();
            });

            selectOptions.forEach(option => {
                option.addEventListener('click', function() {
                    selectOptions.forEach(o => o.classList.remove('active'));
                    this.classList.add('active');
                    document.getElementById('filter-value').innerHTML = this.innerHTML;
                    currentFilter = this.dataset.filter;
                    customSelect.classList.remove('active');
                    renderHospitalGrid();
                });
            });

            document.addEventListener('click', function(e) {
                if (!customSelect.contains(e.target)) customSelect.classList.remove('active');
            });
        }
    }

    function initMapPage() {
        initializeFullMap();
    }

    function initRoutePage() {
        populateModalList();
        initializeRouteMap();
        applyPendingDestination();

        document.querySelectorAll('.route-type-btn').forEach(btn => {
            btn.addEventListener('click', function() {
                document.querySelectorAll('.route-type-btn').forEach(b => b.classList.remove('active'));
                this.classList.add('active');
                currentRouteType = this.dataset.type;
                if (routeLine) calculateRoute();
            });
        });

        bindIfExists('use-my-location', 'click', toggleLocationTracking);
        bindIfExists('select-hospital', 'click', openHospitalModal);
        bindIfExists('set-start-manual', 'click', setStartFromInput);
        bindIfExists('set-end-manual', 'click', setEndFromInput);
        bindIfExists('calculate-route', 'click', calculateRoute);
        bindIfExists('clear-route', 'click', clearRoute);
        bindIfExists('modal-search', 'input', filterModalList);
        bindIfExists('hospital-modal', 'click', function(e) { if (e.target === this) closeModal(); });
    }

    function bindIfExists(id, eventName, handler) {
        const element = document.getElementById(id);
        if (element) element.addEventListener(eventName, handler);
    }

    function getHospitalType(name) {
        name = (name || '').toLowerCase();
        if (name.includes('rsud')) return 'rsud';
        if (name.includes('rsia')) return 'rsia';
        if (name.includes('rumah sakit') || name.includes('rs ')) return 'swasta';
        return 'other';
    }

    function updateStats() {
        const filtered = filterHospitals();
        const total = document.getElementById('home-total-hospitals');
        const filteredCount = document.getElementById('home-filtered-hospitals');
        if (total) total.textContent = hospitalData.length;
        if (filteredCount) filteredCount.textContent = filtered.length;
    }

    function filterHospitals() {
        return hospitalData.filter(hospital => {
            const matchesSearch = hospital.name.toLowerCase().includes(searchQuery) ||
                                 hospital.address.toLowerCase().includes(searchQuery);
            const matchesFilter = currentFilter === 'all' || hospital.type === currentFilter;
            return matchesSearch && matchesFilter;
        });
    }

    function renderHospitalGrid() {
        const grid = document.getElementById('hospital-grid');
        if (!grid) return;

        const filtered = filterHospitals();
        const filteredCount = document.getElementById('home-filtered-hospitals');
        if (filteredCount) filteredCount.textContent = filtered.length;

        grid.innerHTML = '';
        filtered.forEach(hospital => {
            const card = document.createElement('div');
            card.className = 'hospital-card';
            card.innerHTML = `
                <h3>${hospital.name}</h3>
                <p><i class="fas fa-map-marker-alt"></i> ${hospital.address}</p>
                <div class="hospital-card-tags">
                    <span>${hospital.type.toUpperCase()}</span>
                    <span>${hospital.lat.toFixed(4)}, ${hospital.lng.toFixed(4)}</span>
                </div>
            `;
            card.addEventListener('click', () => focusOnHospital(hospital, 'home'));
            grid.appendChild(card);
        });
        updateHomeMapMarkers();
    }

    function focusOnHospital(hospital, mapType) {
        const map = mapType === 'home' ? homeMap : routeMap;
        if (map) map.flyTo([hospital.lat, hospital.lng], 16, { duration: 1.2 });
    }

    function selectHospitalAsDestination(lat, lng, name) {
        if (routeMap) {
            setEndLocation([lat, lng], name);
            return;
        }
        sessionStorage.setItem('selectedHospitalDestination', JSON.stringify({ lat, lng, name }));
        window.location.href = 'rute.html';
    }
    window.selectHospitalAsDestination = selectHospitalAsDestination;

    function applyPendingDestination() {
        const raw = sessionStorage.getItem('selectedHospitalDestination');
        if (!raw) return;
        sessionStorage.removeItem('selectedHospitalDestination');
        try {
            const data = JSON.parse(raw);
            if (data && typeof data.lat === 'number' && typeof data.lng === 'number') {
                setEndLocation([data.lat, data.lng], data.name || 'Tujuan');
            }
        } catch (error) {
            console.error(error);
        }
    }

    function createSmoothMapOptions() {
        return {
            zoomAnimation: true, zoomAnimationThreshold:4, fadeAnimation:true,
            markerZoomAnimation:true, updateWhenZooming:false, updateWhenIdle:true,
            worldCopyJump:true, maxZoom:22, minZoom:10,
            inertia:true, inertiaDeceleration:3000, inertiaMaxSpeed:1500,
            easeLinearity:0.2, wheelPxPerZoomLevel:100
        };
    }

    function addBoundaryLayer(map) {
        if (typeof json_Batas_Administrasi_Pekanbaru_1 !== 'undefined') {
            L.geoJSON(json_Batas_Administrasi_Pekanbaru_1, {
                style: () => ({
                    color:'rgba(59,130,246,0.85)', weight:3,
                    fillColor:'rgba(16,185,129,0.12)', fillOpacity:0.4
                })
            }).addTo(map);
        }
    }

    function initializeHomeMap() {
        const el = document.getElementById('home-map');
        if (!el) return;
        const options = createSmoothMapOptions();
        homeMap = L.map('home-map', options).fitBounds(mapBounds);
        L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom:19 }).addTo(homeMap);
        addBoundaryLayer(homeMap);
        updateHomeMapMarkers();
    }

    function updateHomeMapMarkers() {
        if (!homeMap) return;
        homeMarkers.forEach(m => homeMap.removeLayer(m));
        homeMarkers = [];
        filterHospitals().forEach(hospital => {
            const marker = L.marker([hospital.lat, hospital.lng]).addTo(homeMap);
            marker.bindPopup(createPopupContent(hospital));
            homeMarkers.push(marker);
        });
    }

    function initializeFullMap() {
        const el = document.getElementById('full-map');
        if (!el) return;
        const options = createSmoothMapOptions();
        fullMap = L.map('full-map', options).fitBounds(mapBounds);
        L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom:22 }).addTo(fullMap);
        addBoundaryLayer(fullMap);
        hospitalData.forEach(hospital => {
            const marker = L.marker([hospital.lat, hospital.lng]).addTo(fullMap);
            marker.bindPopup(createPopupContent(hospital));
        });
    }

    function initializeRouteMap() {
        const el = document.getElementById('route-map');
        if (!el) return;
        const options = createSmoothMapOptions();
        routeMap = L.map('route-map', options).fitBounds(mapBounds);
        L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom:22 }).addTo(routeMap);
        addBoundaryLayer(routeMap);

        routeMap.on('click', function(e) {
            if (!startLocation) setStartLocation(e.latlng, 'Lokasi yang dipilih');
            else if (!endLocation) setEndLocation(e.latlng, 'Tujuan yang dipilih');
            else setStartLocation(e.latlng, 'Lokasi baru');
        });

        hospitalData.forEach(hospital => {
            const marker = L.marker([hospital.lat, hospital.lng]).addTo(routeMap);
            marker.bindPopup(createRoutePopupContent(hospital));
        });
    }

    function createPopupContent(hospital) {
        return `
            <div class="popup-title">${hospital.name}</div>
            <div class="popup-info">${hospital.address}</div>
            <div style="color:var(--muted);font-size:0.85rem;font-family:monospace;margin-bottom:12px;">${hospital.lat.toFixed(6)}, ${hospital.lng.toFixed(6)}</div>
            <button class="popup-btn" onclick="selectHospitalAsDestination(${hospital.lat}, ${hospital.lng}, '${hospital.name.replace(/'/g, "\\'")}')">
                <i class="fas fa-route"></i> Jadikan Tujuan
            </button>
        `;
    }

    function createRoutePopupContent(hospital) {
        return `
            <div class="popup-title">${hospital.name}</div>
            <div class="popup-info">${hospital.address}</div>
            <div style="color:var(--muted);font-size:0.8rem;margin-bottom:14px;font-family:monospace;">${hospital.lat.toFixed(6)}, ${hospital.lng.toFixed(6)}</div>
            <button class="popup-btn" onclick="selectHospitalAsDestination(${hospital.lat}, ${hospital.lng}, '${hospital.name.replace(/'/g, "\\'")}')">
                <i class="fas fa-route"></i> Jadikan Tujuan
            </button>
        `;
    }

    function setStartLocation(latlng, label) {
        startLocation = latlng;
        document.getElementById('route-start-name').value = label;
        document.getElementById('route-start-lat').value = (latlng.lat || latlng[0]).toFixed(8);
        document.getElementById('route-start-lng').value = (latlng.lng || latlng[1]).toFixed(8);

        routeMarkers.forEach(m => { if (m.isStart) routeMap.removeLayer(m); });

        const marker = L.marker(latlng, {
            icon: L.divIcon({
                className:'custom-marker',
                html:'<div style="background:#3b82f6;color:#fff;padding:12px 16px;border-radius:50%;font-weight:900;box-shadow:0 8px 25px rgba(59,130,246,0.6);font-size:1.15rem;">A</div>',
                iconSize:[48,48], iconAnchor:[24,24]
            })
        }).addTo(routeMap);
        marker.isStart = true;
        routeMarkers.push(marker);
        routeMap.flyTo(latlng, 16, { duration:1.2 });
    }

    function setEndLocation(latlng, label) {
        endLocation = latlng;
        document.getElementById('route-end-name').value = label;
        document.getElementById('route-end-lat').value = (latlng.lat || latlng[0]).toFixed(8);
        document.getElementById('route-end-lng').value = (latlng.lng || latlng[1]).toFixed(8);

        routeMarkers.forEach(m => { if (m.isEnd) routeMap.removeLayer(m); });

        const marker = L.marker(latlng, {
            icon: L.divIcon({
                className:'custom-marker',
                html:'<div style="background:#ef4444;color:#fff;padding:12px 16px;border-radius:50%;font-weight:900;box-shadow:0 8px 25px rgba(239,68,68,0.6);font-size:1.15rem;">B</div>',
                iconSize:[48,48], iconAnchor:[24,24]
            })
        }).addTo(routeMap);
        marker.isEnd = true;
        routeMarkers.push(marker);
        routeMap.flyTo(latlng, 16, { duration:1.2 });
    }

    function toggleLocationTracking() {
        if (watchId) {
            navigator.geolocation.clearWatch(watchId);
            watchId = null;
            document.getElementById('use-my-location').innerHTML = '<i class="fas fa-crosshairs"></i> Lokasi Saya';
            return;
        }

        if (!navigator.geolocation) { alert('Browser Anda tidak mendukung fitur geolocation'); return; }

        document.getElementById('use-my-location').innerHTML = '<i class="fas fa-spinner fa-spin"></i> Mendeteksi...';

        navigator.geolocation.getCurrentPosition(
            function(pos) {
                const latlng = [pos.coords.latitude, pos.coords.longitude];
                setStartLocation(latlng, 'Lokasi Saya');
                startRealTimeTracking();
            },
            function(err) {
                let msg = 'Tidak dapat mengakses lokasi. ';
                switch(err.code) {
                    case err.PERMISSION_DENIED: msg += 'Anda menolak izin lokasi. Silakan klik peta untuk memilih lokasi awal secara manual.'; break;
                    case err.POSITION_UNAVAILABLE: msg += 'Informasi lokasi tidak tersedia.'; break;
                    case err.TIMEOUT: msg += 'Waktu permintaan lokasi habis. Silakan coba lagi.'; break;
                    default: msg += 'Terjadi kesalahan yang tidak diketahui.';
                }
                alert(msg);
                document.getElementById('use-my-location').innerHTML = '<i class="fas fa-crosshairs"></i> Lokasi Saya';
            },
            { enableHighAccuracy:true, timeout:15000, maximumAge:0 }
        );
    }

    function startRealTimeTracking() {
        document.getElementById('use-my-location').innerHTML = '<i class="fas fa-satellite-dish"></i> Tracking Aktif';
        watchId = navigator.geolocation.watchPosition(
            function(pos) { updateStartLocation([pos.coords.latitude, pos.coords.longitude]); },
            function(err) { console.log('Tracking error:', err); },
            { enableHighAccuracy:true, timeout:10000, maximumAge:0, distanceFilter:5 }
        );
    }

    function updateStartLocation(latlng) {
        startLocation = latlng;
        document.getElementById('route-start-lat').value = latlng[0].toFixed(8);
        document.getElementById('route-start-lng').value = latlng[1].toFixed(8);

        routeMarkers.forEach(m => { if (m.isStart) m.setLatLng(latlng); });
        if (routeLine && endLocation) calculateRoute();
    }

    function setStartFromInput() {
        const lat = parseFloat(document.getElementById('route-start-lat').value);
        const lng = parseFloat(document.getElementById('route-start-lng').value);
        const name = document.getElementById('route-start-name').value || 'Lokasi Input';

        if (isNaN(lat) || isNaN(lng)) { alert('Silakan masukkan koordinat yang valid!'); return; }
        setStartLocation([lat, lng], name);
    }

    function setEndFromInput() {
        const lat = parseFloat(document.getElementById('route-end-lat').value);
        const lng = parseFloat(document.getElementById('route-end-lng').value);
        const name = document.getElementById('route-end-name').value || 'Tujuan Input';

        if (isNaN(lat) || isNaN(lng)) { alert('Silakan masukkan koordinat yang valid!'); return; }
        setEndLocation([lat, lng], name);
    }

    function openHospitalModal() {
        document.getElementById('hospital-modal').classList.add('active');
        document.getElementById('modal-search').value = '';
        filterModalList();
    }

    function closeModal() { document.getElementById('hospital-modal').classList.remove('active'); }
    window.closeModal = closeModal;

    function populateModalList() {
        const list = document.getElementById('modal-list');
        if (!list) return;
        list.innerHTML = '';
        hospitalData.forEach(hospital => {
            const option = document.createElement('div');
            option.className = 'hospital-option';
            option.dataset.name = hospital.name.toLowerCase();
            option.innerHTML = `
                <h4>${hospital.name}</h4>
                <p><i class="fas fa-map-marker-alt"></i> ${hospital.address}</p>
                <small>${hospital.lat.toFixed(6)}, ${hospital.lng.toFixed(6)} • ${hospital.type.toUpperCase()}</small>
            `;
            option.addEventListener('click', () => {
                setEndLocation([hospital.lat, hospital.lng], hospital.name);
                closeModal();
            });
            list.appendChild(option);
        });
    }

    function filterModalList() {
        const search = document.getElementById('modal-search').value.toLowerCase();
        const options = document.querySelectorAll('.hospital-option');
        options.forEach(option => {
            option.style.display = option.dataset.name.includes(search) ? 'block' : 'none';
        });
    }

    function decodePolyline(encoded) {
        let points = [];
        let index = 0, len = encoded.length;
        let lat = 0, lng = 0;
        while (index < len) {
            let b, shift = 0, result = 0;
            do { b = encoded.charCodeAt(index++) - 63; result |= (b & 0x1f) << shift; shift += 5; } while (b >= 0x20);
            let dlat = ((result & 1) ? ~(result >> 1) : (result >> 1));
            lat += dlat;
            shift = 0; result = 0;
            do { b = encoded.charCodeAt(index++) - 63; result |= (b & 0x1f) << shift; shift += 5; } while (b >= 0x20);
            let dlng = ((result & 1) ? ~(result >> 1) : (result >> 1));
            lng += dlng;
            points.push([lat * 1e-5, lng * 1e-5]);
        }
        return points;
    }

    function calculateRoute() {
        if (!startLocation || !endLocation) { alert('Silakan atur lokasi awal dan tujuan terlebih dahulu!'); return; }

        const btn = document.getElementById('calculate-route');
        btn.classList.add('loading');
        btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Menghitung Rute...';

        const startLngLat = [startLocation.lng || startLocation[1], startLocation.lat || startLocation[0]];
        const endLngLat = [endLocation.lng || endLocation[1], endLocation.lat || endLocation[0]];

        const osrmProfile = currentRouteType === 'fastest' ? 'car' : 'car';
        const osrmUrl = `https://router.project-osrm.org/route/v1/${osrmProfile}/${startLngLat.join(',')};${endLngLat.join(',')}?overview=full&geometries=polyline&steps=true`;

        fetch(osrmUrl)
            .then(response => {
                if (!response.ok) throw new Error('Gagal mengambil rute');
                return response.json();
            })
            .then(data => {
                if (!data.routes || data.routes.length === 0) throw new Error('Rute tidak ditemukan');

                const route = data.routes[0];

                if (routeLine) routeMap.removeLayer(routeLine);

                const routeCoords = decodePolyline(route.geometry);
                routeLine = L.polyline(routeCoords, {
                    color: currentRouteType === 'fastest' ? '#10b981' : '#3b82f6',
                    weight:7, opacity:0.95, lineJoin:'round', lineCap:'round'
                }).addTo(routeMap);

                const bounds = routeLine.getBounds();
                routeMap.flyToBounds(bounds, { padding:[100,100], duration:1.6 });

                const distanceKm = (route.distance / 1000).toFixed(2);
                const durationMin = Math.round(route.duration / 60);
                document.getElementById('route-distance').textContent = distanceKm + ' km';
                document.getElementById('route-duration').textContent = durationMin + ' menit';

                const directionsContainer = document.getElementById('route-directions');
                directionsContainer.innerHTML = '';
                if (route.legs && route.legs.length > 0) {
                    const steps = route.legs[0].steps;
                    steps.forEach(step => {
                        const dirDiv = document.createElement('div');
                        dirDiv.className = 'route-direction';

                        let icon = 'fa-arrow-right';
                        let type = step.maneuver ? (step.maneuver.type || '') : '';
                        let modifier = step.maneuver ? (step.maneuver.modifier || '') : '';
                        let instruction = step.maneuver ? (step.maneuver.instruction || '') : '';

                        if (type.includes('depart')) {
                            icon = 'fa-play';
                        } else if (type.includes('arrive') || type.includes('end')) {
                            icon = 'fa-flag-checkered';
                        } else if (modifier.includes('left')) {
                            icon = 'fa-arrow-left';
                        } else if (modifier.includes('right')) {
                            icon = 'fa-arrow-right';
                        } else if (modifier.includes('uturn')) {
                            icon = 'fa-undo';
                        } else {
                            icon = 'fa-arrow-up';
                        }

                        if (!instruction) {
                            instruction = type.includes('depart') ? 'Mulai perjalanan' :
                                          type.includes('arrive') ? 'Tiba di tujuan' :
                                          'Lanjutkan perjalanan';
                        }

                        dirDiv.innerHTML = `
                            <div class="direction-icon"><i class="fas ${icon}"></i></div>
                            <div class="direction-text">
                                <strong>${instruction}</strong>
                                <small>${(step.distance / 1000).toFixed(2)} km • ${Math.round(step.duration / 60)} menit</small>
                            </div>
                        `;
                        directionsContainer.appendChild(dirDiv);
                    });
                }
                document.getElementById('route-summary').style.display = 'block';
            })
            .catch(error => {
                console.error(error);
                alert('Gagal menghitung rute menggunakan OSRM. Menampilkan rute garis lurus sebagai fallback.');
                calculateFallbackRoute();
            })
            .finally(() => {
                btn.classList.remove('loading');
                btn.innerHTML = '<i class="fas fa-route"></i> Hitung & Tampilkan Rute';
            });
    }

    function calculateFallbackRoute() {
        if (routeLine) routeMap.removeLayer(routeLine);

        const start = [startLocation.lat || startLocation[0], startLocation.lng || startLocation[1]];
        const end = [endLocation.lat || endLocation[0], endLocation.lng || endLocation[1]];

        routeLine = L.polyline([start, end], {
            color: currentRouteType === 'fastest' ? '#10b981' : '#3b82f6',
            weight:7, opacity:0.95, lineJoin:'round', lineCap:'round'
        }).addTo(routeMap);

        const bounds = L.latLngBounds([start, end]);
        routeMap.flyToBounds(bounds, { padding:[100,100], duration:1.6 });

        const distance = calculateHaversine(start[0], start[1], end[0], end[1]);
        const duration = Math.round(distance / 0.45);

        document.getElementById('route-distance').textContent = distance.toFixed(2) + ' km';
        document.getElementById('route-duration').textContent = duration + ' menit';

        const directionsContainer = document.getElementById('route-directions');
        directionsContainer.innerHTML = `
            <div class="route-direction">
                <div class="direction-icon"><i class="fas fa-info-circle"></i></div>
                <div class="direction-text">
                    <strong>Rute garis lurus (tanpa rute jalan nyata)</strong>
                    <small>Silakan coba lagi nanti untuk rute yang sebenarnya</small>
                </div>
            </div>
        `;
        document.getElementById('route-summary').style.display = 'block';
    }

    function calculateHaversine(lat1, lon1, lat2, lon2) {
        const R = 6371;
        const dLat = (lat2 - lat1) * Math.PI / 180;
        const dLon = (lon2 - lon1) * Math.PI / 180;
        const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
                  Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
                  Math.sin(dLon/2) * Math.sin(dLon/2);
        return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    }

    function clearRoute() {
        if (routeLine) { routeMap.removeLayer(routeLine); routeLine = null; }

        routeMarkers.forEach(m => routeMap.removeLayer(m));
        routeMarkers = [];

        startLocation = null; endLocation = null;

        ['route-start-name','route-start-lat','route-start-lng','route-end-name','route-end-lat','route-end-lng'].forEach(id => {
            document.getElementById(id).value = '';
        });

        document.getElementById('route-summary').style.display = 'none';

        if (watchId) {
            navigator.geolocation.clearWatch(watchId); watchId = null;
            document.getElementById('use-my-location').innerHTML = '<i class="fas fa-crosshairs"></i> Lokasi Saya';
        }

        routeMap.flyToBounds(mapBounds, { duration:1.2, padding:[50,50] });
    }
})();
