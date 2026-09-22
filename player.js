(function(){
  function init(root){
    var video=root.querySelector('video');
    var play=root.querySelector('[data-play]');
    var overlay=root.querySelector('[data-overlay]');
    var scrub=root.querySelector('[data-scrub]');
    if(!video)return;
    function sync(){
      var d=video.duration||0,t=video.currentTime||0;
      if(scrub&&d) scrub.value=String(t/d*1000);
      root.querySelectorAll('[data-current]').forEach(function(e){e.textContent=fmt(t)});
      root.querySelectorAll('[data-duration]').forEach(function(e){e.textContent=fmt(d)});
      if(overlay)overlay.classList.toggle('hide',!video.paused);
    }
    function fmt(t){if(!isFinite(t)||t<0)t=0;return Math.floor(t/60)+':'+String(Math.floor(t%60)).padStart(2,'0')}
    function toggle(){if(video.paused)video.play().catch(function(){});else video.pause()}
    [play,overlay,video].forEach(function(e){if(e)e.addEventListener('click',toggle)});
    ['play','pause','timeupdate','loadedmetadata'].forEach(function(e){video.addEventListener(e,sync)});
    if(scrub)scrub.addEventListener('input',function(){if(video.duration)video.currentTime=Number(scrub.value)/1000*video.duration});
    root.querySelectorAll('[data-rate]').forEach(function(b){b.addEventListener('click',function(){video.playbackRate=Number(b.dataset.rate);root.querySelectorAll('[data-rate]').forEach(function(x){x.classList.toggle('on',x===b)})})});
    sync();
  }
  document.querySelectorAll('[data-presentation]').forEach(init);
})();
