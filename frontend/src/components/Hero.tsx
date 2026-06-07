export default function Hero() {
  return (
    <section className="relative overflow-hidden bg-canvas py-section text-center">
      <div className="orb orb-mint" style={{ top: "-100px", left: "20%" }}></div>
      <div className="orb orb-peach" style={{ bottom: "-50px", right: "10%" }}></div>
      
      <div className="relative z-10 mx-auto max-w-[1200px] px-6">
        <h1 className="display-mega mb-6">
          Your Campus <br />
          Intelligence Agent.
        </h1>
        <p className="body-md mx-auto mb-8 max-w-[600px] text-body">
          Upload your campus handbook and get instant, accurate answers <br />
          powered by edge AI. Quietly editorial, deeply capable.
        </p>
        <div className="flex justify-center gap-4">
          <button className="btn-primary">Start Chatting</button>
          <button className="btn-outline">Learn More</button>
        </div>
      </div>
    </section>
  );
}
