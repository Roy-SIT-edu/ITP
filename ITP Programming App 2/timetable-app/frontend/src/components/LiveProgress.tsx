import { useEffect, useState } from "react";
import { Terminal, CheckCircle2, Loader2, ServerCog, Cpu, Globe2 } from "lucide-react";
import "./LiveProgress.css";

type LogStep = {
  id: string;
  text: string;
  icon: any;
  duration: number;
  status: "pending" | "running" | "done";
};

export default function LiveProgress() {
  const [steps, setSteps] = useState<LogStep[]>([
    { id: "s1", text: "Analyzing conflicts and unlocking fixed constraints...", icon: ServerCog, duration: 1500, status: "running" },
    { id: "s2", text: "Attempt 1: Running CP-SAT solver (Campus Delivery)...", icon: Cpu, duration: 4000, status: "pending" },
    { id: "s3", text: "Attempt 1 failed. Fallback: Converting non-lab modules to Online delivery...", icon: Globe2, duration: 1000, status: "pending" },
    { id: "s4", text: "Attempt 2: Running CP-SAT solver (Online Delivery)...", icon: Cpu, duration: 3000, status: "pending" },
    { id: "s5", text: "Validating optimal schedule...", icon: CheckCircle2, duration: 500, status: "pending" },
  ]);

  useEffect(() => {
    let currentStep = 0;
    
    const advance = () => {
      if (currentStep >= steps.length) return;
      
      const step = steps[currentStep];
      setSteps(prev => prev.map((s, i) => 
        i === currentStep ? { ...s, status: "running" } : 
        i < currentStep ? { ...s, status: "done" } : s
      ));
      
      setTimeout(() => {
        currentStep++;
        if (currentStep <= steps.length) {
            setSteps(prev => prev.map((s, i) => 
                i < currentStep ? { ...s, status: "done" } : s
            ));
        }
        advance();
      }, step.duration);
    };
    
    // Start after a small delay
    const timer = setTimeout(advance, 500);
    return () => clearTimeout(timer);
  }, []);

  return (
    <div className="live-progress-container">
      <div className="live-progress-header">
        <Terminal size={16} />
        <span>Backend Solver Execution Log</span>
      </div>
      <div className="live-progress-body">
        {steps.map((step) => {
          if (step.status === "pending") return null;
          const Icon = step.icon;
          return (
            <div key={step.id} className={`live-progress-row ${step.status}`}>
              <div className="live-progress-icon">
                {step.status === "running" ? <Loader2 className="spin" size={14} /> : <CheckCircle2 size={14} />}
              </div>
              <div className="live-progress-text">
                <span className="live-progress-time">{new Date().toLocaleTimeString([], { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" })}</span>
                <Icon size={14} className="live-progress-accent" />
                {step.text}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
